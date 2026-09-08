// settings.rs — the single user-preferences store (schema v3, atomic writes).
// Everything the user personalizes lives HERE: language, auto-stop.
// Thresholds are NOT stored anymore — they're computed per machine each session.
// Corruption policy: any unreadable file = defaults, silently. Never crash.

use std::fs;
use std::path::PathBuf;

use super::types::Thresholds;

pub const SETTINGS_VERSION: u32 = 3;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct Settings {
    pub version: u32,
    /// legacy from v2 — ignored by the engine (thresholds are dynamic now),
    /// kept only so old files migrate without surprises.
    pub sensitivity: String,
    /// default auto-stop in minutes (bounded 5..=60 by the UI/engine);
    /// 5 = the lightest scan, the default for every new user
    pub auto_stop_minutes: u32,
    /// "auto" (follow the OS at launch) | "en" | "ar" (user toggle)
    pub language: String,
    /// "dark" | "light" | "auto" (follow the OS theme); dark preserves the
    /// look every existing install already has
    #[serde(default = "default_theme")]
    pub theme: String,
    /// sidebar collapsed (icons-only rail)
    pub sidebar_collapsed: bool,
    /// first-run welcome screen done — never shown again after the first launch
    pub onboarding_done: bool,
    /// the pre-scan advice ("close background apps") — shown ONCE EVER, the
    /// first time the app confirms the game is running; never again after
    /// the user dismisses it
    #[serde(default)]
    pub game_advice_done: bool,
    /// the stay-in-game advice — shown ONCE EVER, the first time a RUNNING
    /// session measures the game window in the background; never again
    #[serde(default)]
    pub background_advice_done: bool,
    /// the release version whose update modal has already been shown once
    /// (the modal appears ONCE per version; after that the About dot is the
    /// only signal until the next version lands)
    #[serde(default)]
    pub announced_update_version: Option<String>,
    /// schema-compat placeholder — recomputed per session, never read back
    pub thresholds: Thresholds,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            sensitivity: "standard".into(),
            // new users start with the lightest scan: 5 minutes
            auto_stop_minutes: 5,
            language: "auto".into(),
            theme: default_theme(),
            sidebar_collapsed: false,
            onboarding_done: false,
            game_advice_done: false,
            background_advice_done: false,
            announced_update_version: None,
            thresholds: Thresholds::default(),
        }
    }
}

pub fn settings_path() -> PathBuf {
    super::storage::app_dir().join("settings.json")
}

/// Load settings with migration:
///   v2 file (no `language` key) → gains `language: "auto"` — nothing lost.
///   v1 layout (bare Thresholds + prefs file) → merged into one v3 file.
/// A bare-thresholds file parses as Settings via serde defaults — so detect the
/// legacy layout by CONTENT (missing `sensitivity` key) before deciding.
pub fn load() -> Settings {
    let path = settings_path();
    let Ok(text) = fs::read_to_string(&path) else {
        return Settings::default();
    };

    // v3/v2 file: has both "version" and "sensitivity" keys
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
        let has_sens = v.get("sensitivity").is_some();
        let version = v.get("version").and_then(|x| x.as_u64()).unwrap_or(0);
        if has_sens && version >= 2 {
            if let Ok(s) = serde_json::from_str::<Settings>(&text) {
                // migrate v2 → v3 in place if needed (gains language, clamps)
                let mut s = s;
                if s.version < SETTINGS_VERSION {
                    s.version = SETTINGS_VERSION;
                    s.language = normalize_language(&s.language);
                    s.auto_stop_minutes = clamp_auto_stop(s.auto_stop_minutes);
                    let _ = save(&s);
                }
                return s;
            }
        }
    }

    // ---- legacy migration (v1: thresholds file + prefs file) ----
    let mut migrated = Settings::default();

    // 1) thresholds from the old bare file
    if let Ok(th) = serde_json::from_str::<Thresholds>(&text) {
        migrated.thresholds = th;
    }
    // 2) sensitivity from prefs, if present — kept as a mute legacy value
    let prefs_path = super::storage::app_dir().join("settings.prefs.json");
    if let Ok(prefs_text) = fs::read_to_string(&prefs_path) {
        if let Ok(p) = serde_json::from_str::<serde_json::Value>(&prefs_text) {
            if let Some(s) = p.get("sensitivity").and_then(|x| x.as_str()) {
                migrated.sensitivity = s.to_string();
            }
        }
    }

    // persist the migrated result and retire the legacy files
    let _ = save(&migrated);
    let _ = fs::remove_file(&prefs_path);

    migrated
}

/// Atomic save: write to a temp file, then rename over the target.
/// A crash mid-write can never leave a half-written settings.json.
pub fn save(s: &Settings) -> Result<(), String> {
    let path = settings_path();
    let dir = path.parent().ok_or("no settings dir")?;
    fs::create_dir_all(dir).map_err(|e| format!("cannot create app dir: {e}"))?;

    let tmp = dir.join("settings.json.tmp");
    let body = serde_json::to_string_pretty(s).map_err(|e| format!("serialize: {e}"))?;
    fs::write(&tmp, body).map_err(|e| format!("cannot write temp: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("cannot commit settings: {e}"))?;
    Ok(())
}

/// Validate + clamp an auto-stop choice coming from the UI.
pub fn clamp_auto_stop(minutes: u32) -> u32 {
    minutes.clamp(5, 60)
}

/// Language values the UI can send; anything else means "auto".
pub fn normalize_language(lang: &str) -> String {
    match lang {
        "en" => "en".into(),
        "ar" => "ar".into(),
        _ => "auto".into(),
    }
}

/// Theme values the UI can send. Default is "dark" (not "auto") on purpose:
/// existing installs must keep the exact look they already have; "auto"
/// would flip light-OS users without consent. New users opt in explicitly.
pub fn normalize_theme(theme: &str) -> String {
    match theme {
        "light" => "light".into(),
        "auto" => "auto".into(),
        _ => "dark".into(),
    }
}

pub fn default_theme() -> String {
    "dark".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrupted_file_falls_back_to_defaults() {
        let text = "{ this is not json !!!";
        let v: Result<serde_json::Value, _> = serde_json::from_str(text);
        assert!(v.is_err());
    }

    #[test]
    fn legacy_thresholds_file_migrates_without_losing_prefs() {
        let old = serde_json::json!({
            "cpu_saturation_pct": 90.0,
            "proc_perf_floor_pct": 70.0,
            "proc_perf_load_gate": 50.0,
            "avail_mem_floor_mb": 2048.0,
            "hard_faults_per_sec": 300.0,
            "disk_queue_len": 2.0,
            "disk_busy_pct": 90.0,
            "gpu_clock_floor_pct": 60.0,
            "gpu_temp_warn_c": 85.0,
            "gpu_temp_crit_c": 92.0,
            "spike_cpu_drop_pct": 15.0,
            "spike_sustained_sec": 3
        });
        let th: Thresholds = serde_json::from_value(old).unwrap();
        assert_eq!(th.cpu_saturation_pct, 90.0);
        let v = serde_json::to_value(&th).unwrap();
        assert!(v.get("sensitivity").is_none());
    }

    #[test]
    fn v3_roundtrip_preserves_everything() {
        let s = Settings {
            version: 3,
            sensitivity: "standard".into(),
            auto_stop_minutes: 60,
            language: "ar".into(),
            theme: "light".into(),
            sidebar_collapsed: false,
            onboarding_done: true,
            game_advice_done: true,
            background_advice_done: true,
            announced_update_version: Some("1.3.0".into()),
            thresholds: Thresholds::default(),
        };
        let text = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&text).unwrap();
        assert_eq!(back.language, "ar");
        assert_eq!(back.theme, "light");
        assert_eq!(back.auto_stop_minutes, 60);
        assert_eq!(back.version, 3);
        assert_eq!(back.announced_update_version.as_deref(), Some("1.3.0"));
        assert!(back.game_advice_done);
        assert!(back.background_advice_done);
    }

    #[test]
    fn old_settings_file_defaults_theme_to_dark() {
        // settings.json written before the theme existed has no theme key —
        // serde default keeps "dark" so existing installs never change look
        let old = serde_json::json!({
            "version": 3,
            "sensitivity": "standard",
            "auto_stop_minutes": 5,
            "language": "auto",
            "sidebar_collapsed": false,
            "onboarding_done": true
        });
        let text = serde_json::to_string(&old).unwrap();
        let back: Settings = serde_json::from_str(&text).unwrap();
        assert_eq!(back.theme, "dark");
    }

    #[test]
    fn normalize_theme_rejects_unknown() {
        assert_eq!(normalize_theme("light"), "light");
        assert_eq!(normalize_theme("auto"), "auto");
        assert_eq!(normalize_theme("dark"), "dark");
        assert_eq!(normalize_theme("blue"), "dark");
        assert_eq!(normalize_theme(""), "dark");
    }

    #[test]
    fn pre_update_settings_file_parses_without_the_new_field() {
        // a settings.json written BEFORE the updater existed has no
        // announced_update_version key — serde default keeps it None
        let old = serde_json::json!({
            "version": 3,
            "sensitivity": "standard",
            "auto_stop_minutes": 5,
            "language": "auto",
            "sidebar_collapsed": false,
            "onboarding_done": true,
            "thresholds": Thresholds::default()
        });
        let s: Settings = serde_json::from_value(old).unwrap();
        assert_eq!(s.announced_update_version, None);
    }

    #[test]
    fn v2_file_gains_language_on_migration_parse() {
        // a v2 file (no language key) parses via serde defaults → language = "auto"
        let v2 = serde_json::json!({
            "version": 2,
            "sensitivity": "high",
            "auto_stop_minutes": 30,
            "thresholds": Thresholds::default()
        });
        let s: Settings = serde_json::from_value(v2).unwrap();
        assert_eq!(s.language, "auto"); // defaulted — then persisted as v3 on load
        assert_eq!(s.sensitivity, "high"); // preserved as legacy
    }

    #[test]
    fn auto_stop_clamped() {
        assert_eq!(clamp_auto_stop(0), 5);
        assert_eq!(clamp_auto_stop(30), 30);
        assert_eq!(clamp_auto_stop(9999), 60);
    }

    #[test]
    fn language_normalized() {
        assert_eq!(normalize_language("en"), "en");
        assert_eq!(normalize_language("ar"), "ar");
        assert_eq!(normalize_language("auto"), "auto");
        assert_eq!(normalize_language("fr"), "auto"); // unknown → auto
        assert_eq!(normalize_language("garbage"), "auto");
    }
}
