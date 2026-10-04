// settings.rs — the single user-preferences store (schema v3, atomic writes).
// Everything the user personalizes lives HERE: language, auto-stop.
// Thresholds are NOT stored anymore — they're computed per machine each session.
// Corruption policy: any unreadable file = defaults, silently. Never crash.

use std::fs;
use std::path::PathBuf;

use super::types::Thresholds;

pub const SETTINGS_VERSION: u32 = 3;

/// A write waiting for a reboot (page file first; generic by tweak id
/// for whatever needs it next).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PendingRestart {
    pub tweak: String,
    pub at_uptime_ms: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct Settings {
    pub version: u32,
    /// legacy from v2 — ignored by the engine (thresholds are dynamic now),
    /// kept only so old files migrate without surprises.
    #[serde(skip_serializing)]
    pub sensitivity: String,
    /// default auto-stop in minutes (bounded 5..=60 by the UI/engine);
    /// 5 = the lightest scan, the default for every new user
    pub auto_stop_minutes: u32,
    /// "auto" (follow the OS at launch) | "en" | "ar" (user toggle)
    pub language: String,
    /// "dark" | "light" | "auto" (follow the OS theme). "auto" is the
    /// default: a fresh install follows the system until the user picks
    /// one explicitly in Settings.
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
    /// dismissed one-shot page cards, by card id ("processes", "health",
    /// "pagefile", "cleanup"). One list, never one flag per card: new
    /// cards slot in with zero schema work, and old files stay valid
    /// through the serde default above.
    #[serde(default)]
    pub dismissed_cards: Vec<String>,
    /// the release version whose update modal has already been shown once
    /// (the modal appears ONCE per version; after that the About dot is the
    /// only signal until the next version lands)
    #[serde(default)]
    pub announced_update_version: Option<String>,
    /// the GameLoop client version seen at the last Tools read
    /// (e.g. "7.0.19.05"). Compared on every tweak_states read: a change
    /// fires the one-time re-flip notice (client updates orphan path-keyed
    /// GPU/FSO prefs). serde default keeps old files valid, no migration.
    #[serde(default)]
    pub last_seen_gameloop_version: Option<String>,
    /// the power plan active before the user first enabled High
    /// Performance through Tools (GUID string). OFF restores exactly this,
    /// never a hardcoded plan. None = never enabled (or enabled while
    /// already on High Performance). serde default keeps old files valid.
    #[serde(default)]
    pub previous_power_guid: Option<String>,
    /// a write waiting for a reboot: which tweak plus the uptime clock at
    /// write time. Self-clearing (the clock zeroes on reboot, no writes
    /// involved); serde default keeps old files valid.
    #[serde(default)]
    pub pending_restart: Option<PendingRestart>,
    /// schema-compat placeholder — recomputed per session, never read back
    #[serde(skip_serializing)]
    pub thresholds: Thresholds,
}

/// Record one dismissed intro card id: trims, drops empties and absurd
/// lengths (a corrupt caller must not grow the file), dedupes repeats.
/// True when the list actually grew.
pub fn note_dismissed_cards(list: &mut Vec<String>, id: &str) -> bool {
    let id = id.trim();
    if id.is_empty() || id.len() > 64 || list.iter().any(|d| d == id) {
        return false;
    }
    list.push(id.to_string());
    true
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
            dismissed_cards: Vec::new(),
            announced_update_version: None,
            last_seen_gameloop_version: None,
            previous_power_guid: None,
            pending_restart: None,
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
/// The migration write itself goes through `update()` below, so a user
/// toggle landing in the same moment cannot be overwritten by our upgrade.
pub fn load() -> Settings {
    let Ok(text) = fs::read_to_string(settings_path()) else {
        return Settings::default();
    };
    if migration_kind(&text) == MigrationKind::Current {
        return parse_settings_text(&text);
    }
    update(|s| s.clone()).unwrap_or_else(|_| upgrade_text(&text).0)
}

/// What on-disk shape was found: modern files need nothing, v2 files need
/// a field upgrade, legacy/garbage files need a full merge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MigrationKind {
    Current,
    BumpV2,
    Legacy,
}

fn migration_kind(text: &str) -> MigrationKind {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(text) {
        let version = v.get("version").and_then(|x| x.as_u64()).unwrap_or(0);
        // New-format files (v3+: sensitivity/thresholds omitted via
        // skip_serializing) are current by version alone — requiring the
        // legacy key here misclassified every file we write as Legacy and
        // reset all prefs on the next launch.
        if version >= SETTINGS_VERSION as u64 {
            return MigrationKind::Current;
        }
        if v.get("sensitivity").is_some() && version >= 2 {
            return MigrationKind::BumpV2;
        }
    }
    MigrationKind::Legacy
}

fn prefs_path() -> PathBuf {
    super::storage::app_dir().join("settings.prefs.json")
}

fn parse_settings_text(text: &str) -> Settings {
    serde_json::from_str::<Settings>(text).unwrap_or_default()
}

/// Upgrade on-disk text to the current schema in memory. Pure derivation
/// (no writes, no removals): the single place both `load()` and
/// `update()` compute their starting state from, so a concurrent set_*
/// and a first-boot migration can never act on two different pictures of
/// the file. The bool says whether the legacy prefs file may be retired
/// — but only AFTER the upgraded file has been successfully saved.
fn upgrade_text(text: &str) -> (Settings, bool) {
    match migration_kind(text) {
        MigrationKind::Current => (parse_settings_text(text), false),
        MigrationKind::BumpV2 => {
            let mut s = parse_settings_text(text);
            s.version = SETTINGS_VERSION;
            s.language = normalize_language(&s.language);
            s.auto_stop_minutes = clamp_auto_stop(s.auto_stop_minutes);
            (s, false)
        }
        MigrationKind::Legacy => {
            let mut migrated = Settings::default();
            // 1) thresholds from the old bare file
            if let Ok(th) = serde_json::from_str::<Thresholds>(text) {
                migrated.thresholds = th;
            }
            // 2) sensitivity from prefs, if present — kept as a mute legacy value
            let mut retire = false;
            if let Ok(prefs_text) = fs::read_to_string(prefs_path()) {
                retire = true;
                if let Ok(p) = serde_json::from_str::<serde_json::Value>(&prefs_text) {
                    if let Some(s) = p.get("sensitivity").and_then(|x| x.as_str()) {
                        migrated.sensitivity = s.to_string();
                    }
                }
            }
            migrated.version = SETTINGS_VERSION;
            (migrated, retire)
        }
    }
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

/// Serialize every read-modify-write against the same lock: concurrent
/// set_* commands each used to load→mutate→save independently, so two
/// overlapping writes raced on the fixed .tmp name and the loser's
/// change silently vanished (the winner's save never saw it). One mutex
/// per process makes each update atomic end-to-end. Modern `load()`
/// readers stay lock-free (they only ever see committed files); a load
/// that finds an upgrade pending runs through this same serialized path
/// instead of saving around it.
static SETTINGS_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn update<R>(mutate: impl FnOnce(&mut Settings) -> R) -> Result<R, String> {
    let _guard = SETTINGS_WRITE_LOCK
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    let text = fs::read_to_string(settings_path()).unwrap_or_default();
    let (mut s, retire_prefs) = upgrade_text(&text);
    let ret = mutate(&mut s);
    save(&s)?;
    if retire_prefs {
        let _ = fs::remove_file(prefs_path());
    }
    Ok(ret)
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

/// Theme values the UI can send. Unknown values mean "auto" (follow the
/// OS) — the same rule the frontend's resolveTheme applies, so the two
/// sides can never disagree on a stored value.
pub fn normalize_theme(theme: &str) -> String {
    match theme {
        "light" => "light".into(),
        "dark" => "dark".into(),
        _ => "auto".into(),
    }
}

pub fn default_theme() -> String {
    "auto".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_kind_detects_layouts() {
        // modern v3: no upgrade, no writes
        assert_eq!(
            migration_kind(r#"{"version":3,"sensitivity":"standard"}"#),
            MigrationKind::Current
        );
        // future versions are never downgraded
        assert_eq!(
            migration_kind(r#"{"version":9,"sensitivity":"standard"}"#),
            MigrationKind::Current
        );
        // v2: field upgrade only
        assert_eq!(
            migration_kind(r#"{"version":2,"sensitivity":"high"}"#),
            MigrationKind::BumpV2
        );
        // new-format v3 (sensitivity/thresholds omitted by skip_serializing):
        // current by version alone — this is what save() writes now
        assert_eq!(
            migration_kind(
                r#"{"version":3,"auto_stop_minutes":10,"language":"ar","theme":"dark","sidebar_collapsed":true,"onboarding_done":true,"game_advice_done":true,"background_advice_done":true,"announced_update_version":null,"previous_power_guid":null,"pending_restart":null}"#
            ),
            MigrationKind::Current
        );
        // bare thresholds and garbage: full legacy merge
        assert_eq!(
            migration_kind(r#"{"cpu_saturation_pct":90.0}"#),
            MigrationKind::Legacy
        );
        assert_eq!(migration_kind("{ this is not json !!!"), MigrationKind::Legacy);
        assert_eq!(migration_kind(""), MigrationKind::Legacy);
    }

    #[test]
    fn new_format_file_upgrades_without_losing_prefs() {
        // what save() writes today: v3 with no sensitivity/thresholds keys.
        // upgrade_text must keep every pref (the old content-based detector
        // reset all of these to defaults on every launch).
        let s = Settings {
            version: SETTINGS_VERSION,
            sensitivity: "standard".into(),
            auto_stop_minutes: 10,
            language: "ar".into(),
            theme: "dark".into(),
            sidebar_collapsed: true,
            onboarding_done: true,
            game_advice_done: true,
            background_advice_done: true,
            announced_update_version: None,
            last_seen_gameloop_version: None,
            previous_power_guid: None,
            pending_restart: None,
            dismissed_cards: vec!["processes".into()],
            thresholds: Thresholds::default(),
        };
        let text = serde_json::to_string(&s).unwrap();
        assert!(!text.contains("sensitivity"));
        let (back, retire) = upgrade_text(&text);
        assert!(!retire);
        assert_eq!(back.language, "ar");
        assert_eq!(back.theme, "dark");
        assert_eq!(back.auto_stop_minutes, 10);
        assert!(back.onboarding_done);
        assert!(back.game_advice_done);
        assert!(back.background_advice_done);
        assert!(back.sidebar_collapsed);
    }

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
            last_seen_gameloop_version: Some("7.0.19.05".into()),
            previous_power_guid: None,
            pending_restart: None,
            dismissed_cards: vec!["health".into()],
            thresholds: Thresholds::default(),
        };
        let text = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&text).unwrap();
        assert_eq!(back.language, "ar");
        assert_eq!(back.theme, "light");
        assert_eq!(back.auto_stop_minutes, 60);
        assert_eq!(back.version, 3);
        assert_eq!(back.announced_update_version.as_deref(), Some("1.3.0"));
        assert_eq!(back.last_seen_gameloop_version.as_deref(), Some("7.0.19.05"));
        assert!(back.game_advice_done);
        assert!(back.background_advice_done);
        assert_eq!(back.dismissed_cards, vec!["health".to_string()]);
    }

    #[test]
    fn old_files_without_dismissed_cards_stay_valid() {
        // a v3 file written before intro cards existed carries no list:
        // serde default keeps it readable with an empty dismissal list
        let back: Settings = serde_json::from_str(
            r#"{"version":3,"auto_stop_minutes":10,"language":"ar","theme":"dark","sidebar_collapsed":true,"onboarding_done":true,"game_advice_done":true,"background_advice_done":true,"announced_update_version":null,"previous_power_guid":null,"pending_restart":null}"#,
        )
        .unwrap();
        assert!(back.dismissed_cards.is_empty());
    }

    #[test]
    fn dismissing_cards_appends_once_and_ignores_garbage() {
        let mut list = Vec::new();
        assert!(note_dismissed_cards(&mut list, "processes"));
        assert_eq!(list, vec!["processes".to_string()]);
        // repeats and padded repeats never duplicate the row
        assert!(!note_dismissed_cards(&mut list, "processes"));
        assert!(!note_dismissed_cards(&mut list, "  processes  "));
        assert_eq!(list.len(), 1);
        // empties and absurd ids never reach the file
        assert!(!note_dismissed_cards(&mut list, ""));
        assert!(!note_dismissed_cards(&mut list, "   "));
        assert!(!note_dismissed_cards(&mut list, &"x".repeat(65)));
        assert_eq!(list, vec!["processes".to_string()]);
    }

    #[test]
    fn old_settings_file_defaults_theme_to_auto() {
        // settings.json written before the theme existed has no theme key —
        // serde default follows the OS until the user picks one explicitly
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
        assert_eq!(back.theme, "auto");
    }

    #[test]
    fn normalize_theme_rejects_unknown() {
        assert_eq!(normalize_theme("light"), "light");
        assert_eq!(normalize_theme("auto"), "auto");
        assert_eq!(normalize_theme("dark"), "dark");
        assert_eq!(normalize_theme("blue"), "auto");
        assert_eq!(normalize_theme(""), "auto");
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
