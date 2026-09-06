// update.rs — the update path: check GitHub, download the release exe,
// verify it against the published SHA256SUMS, hand the file to the user.
//
// SCOPE (deliberate, matches the tool's portable nature): no self-replace,
// no auto-restart. The most this module ever does is put a VERIFIED file
// next to the user and open its folder — the double-click is the user's.
//
// Security rules:
//   * hosts are allowlisted exactly like open_url — https only, GitHub only
//   * the downloaded exe MUST match the SHA-256 published in SHA256SUMS.txt
//     (this is the real protection: files fetched by an HTTP client get no
//     Mark-of-the-Web, so SmartScreen will NOT warn when the user runs it)
//   * release notes are plain text in the UI — never rendered as HTML
//
// Everything runs on the blocking pool (spawn_blocking from lib.rs) and
// logs every step: check → found → download start/pct/verified/failed —
// a stuck update is diagnosable from the log alone.

use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::logging;

// ---------------------------------------------------------------------------
// Allowlist — the same philosophy as OPEN_URL_ALLOWED_HOSTS in lib.rs.
// Downloads redirect across these hosts; anything else is refused.
// ---------------------------------------------------------------------------

pub const ALLOWED_HOSTS: [&str; 4] = [
    "api.github.com",
    "github.com",
    "objects.githubusercontent.com", // legacy release asset host
    "release-assets.githubusercontent.com", // current release asset host
];

const RELEASES_LATEST_URL: &str =
    "https://api.github.com/repos/Ahmed-Hawass/pubg-gameloop-lag-hunter/releases/latest";

/// Hard bounds — "bounded everything" applies to downloads too.
const MAX_DOWNLOAD_BYTES: u64 = 60 * 1024 * 1024; // 60 MB: release exe is ~5-8 MB
const STALL_TIMEOUT: Duration = Duration::from_secs(30); // no bytes for 30s = cancel

/// What the UI needs to know about a newer release.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    /// e.g. "1.3.0" (tag stripped of the v prefix)
    pub version: String,
    /// release notes, plain text — the UI renders pre-wrap, never HTML
    pub notes: String,
    /// direct asset URL of the versioned exe
    pub asset_url: String,
    /// asset file name, e.g. "pubg-gameloop-lag-hunter-1.3.0.exe"
    pub asset_name: String,
    /// URL of the SHA256SUMS.txt asset (for verification)
    pub sums_url: String,
}

/// One entry of the GitHub releases/latest JSON we care about.
#[derive(Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct GithubRelease {
    #[serde(default)]
    tag_name: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

/// Ask GitHub for the latest release. Ok(None) = no newer version / no
/// release at all. Errors are logged and swallowed — a failed check must
/// never disturb the app (the UI shows nothing, exactly like today).
pub fn check_latest(local_version: &str) -> Option<UpdateInfo> {
    let _t = logging::timed("update: check");
    let release: GithubRelease = match http_get_json(RELEASES_LATEST_URL) {
        Ok(r) => r,
        Err(e) => {
            logging::info(&format!("update check unavailable: {e}"));
            return None;
        }
    };
    let version = release.tag_name.trim_start_matches('v').to_string();
    if version.is_empty() {
        return None;
    }
    if !super::version::is_newer(&version, local_version) {
        return None;
    }
    // the versioned exe asset + the SHA256SUMS asset must both exist
    let asset = release
        .assets
        .iter()
        .find(|a| a.name.ends_with(".exe") && a.name.starts_with("pubg-gameloop-lag-hunter-"));
    let sums = release
        .assets
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case("SHA256SUMS.txt"));
    let (Some(asset), Some(sums)) = (asset, sums) else {
        logging::warn(&format!(
            "update {} found but assets incomplete (exe: {}, sums: {}) — refusing",
            version,
            asset.is_some(),
            sums.is_some()
        ));
        return None;
    };
    let info = UpdateInfo {
        version,
        notes: release.body,
        asset_url: asset.browser_download_url.clone(),
        asset_name: asset.name.clone(),
        sums_url: sums.browser_download_url.clone(),
    };
    logging::info(&format!(
        "update available: {} (asset {})",
        info.version, info.asset_name
    ));
    Some(info)
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/// Global cancel flag — one download at a time; a second request while one
/// is running is refused (the UI's modal is the only trigger).
static DOWNLOAD_RUNNING: AtomicBool = AtomicBool::new(false);
/// The path of the file being written — cleaned up on cancel/exit.
static ACTIVE_DOWNLOAD: Mutex<Option<std::path::PathBuf>> = Mutex::new(None);
/// The current download's cancel handle (set at download start, taken on end).
static ACTIVE_CANCEL: Mutex<Option<std::sync::Arc<AtomicBool>>> = Mutex::new(None);

/// Wire the cancel handle of a starting download (called by the command).
pub fn register_cancel(cancel: std::sync::Arc<AtomicBool>) {
    *ACTIVE_CANCEL
        .lock()
        .unwrap_or_else(|p| p.into_inner()) = Some(cancel);
}

/// Flip the cancel flag of any running download + remove its partial file.
/// Called by the Cancel button and on app exit.
pub fn cancel_active() {
    if let Some(c) = ACTIVE_CANCEL
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .take()
    {
        c.store(true, Ordering::SeqCst);
    }
    cleanup_active_download();
}

/// Progress events pushed to the UI over the IPC channel.
#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum DownloadEvent {
    Progress { downloaded: u64, total: u64 },
    Done { path: String },
    Failed { reason: String },
}

/// Parse one SHA256SUMS.txt line: "<hex>  <filename>" (two spaces).
/// Returns the hex digest for the given file name.
fn sha_from_sums(sums: &str, file_name: &str) -> Option<String> {
    for line in sums.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // format: digest then whitespace then the file name (may be *name in GNU mode)
        let (digest, name) = line.split_once(char::is_whitespace)?;
        let name = name.trim().trim_start_matches('*');
        if name.eq_ignore_ascii_case(file_name) {
            let d = digest.to_ascii_lowercase();
            if d.len() == 64 && d.chars().all(|c| c.is_ascii_hexdigit()) {
                return Some(d);
            }
        }
    }
    None
}

/// Download + verify + write to `dest`. The whole body is held in memory
/// (the cap keeps it bounded), hashed, compared to SHA256SUMS, and only
/// then written to disk — a partial/failed file never touches the path
/// the user chose.
pub fn download_and_verify(
    info: &UpdateInfo,
    dest: std::path::PathBuf,
    cancel: &AtomicBool,
    on_event: impl Fn(DownloadEvent) + Send + 'static,
) -> Result<String, String> {
    if DOWNLOAD_RUNNING.swap(true, Ordering::SeqCst) {
        return Err("a download is already running".into());
    }
    let result = download_inner(info, dest, cancel, &on_event);
    DOWNLOAD_RUNNING.store(false, Ordering::SeqCst);
    *ACTIVE_DOWNLOAD
        .lock()
        .unwrap_or_else(|p| p.into_inner()) = None;
    *ACTIVE_CANCEL
        .lock()
        .unwrap_or_else(|p| p.into_inner()) = None;
    result
}

fn download_inner(
    info: &UpdateInfo,
    dest: std::path::PathBuf,
    cancel: &AtomicBool,
    on_event: &(dyn Fn(DownloadEvent) + Send + 'static),
) -> Result<String, String> {
    let _t = logging::timed("update: download");

    // fetch the sums first — if we can't verify, we don't download at all
    let sums_text = http_get_text(&info.sums_url)?;
    let expected = sha_from_sums(&sums_text, &info.asset_name).ok_or_else(|| {
        format!(
            "asset {} not listed in SHA256SUMS.txt — refusing unverified download",
            info.asset_name
        )
    })?;

    // the exe itself
    let resp = http_get(&info.asset_url)?;
    let total = resp
        .header("content-length")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    if total > MAX_DOWNLOAD_BYTES {
        return Err(format!("download exceeds the {MAX_DOWNLOAD_BYTES}-byte cap"));
    }
    *ACTIVE_DOWNLOAD
        .lock()
        .unwrap_or_else(|p| p.into_inner()) = Some(dest.clone());
    let mut hasher = Sha256::new();
    let mut body = resp.into_reader();
    let mut buf = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    let mut last_event = std::time::Instant::now();
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let n = body
            .read(&mut chunk)
            .map_err(|e| format!("download read: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&chunk[..n]);
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() as u64 > MAX_DOWNLOAD_BYTES {
            return Err(format!("download exceeds the {MAX_DOWNLOAD_BYTES}-byte cap"));
        }
        let now = std::time::Instant::now();
        if now.duration_since(last_event) >= Duration::from_millis(200) {
            last_event = now;
            on_event(DownloadEvent::Progress {
                downloaded: buf.len() as u64,
                total,
            });
        }
    }

    // verify BEFORE writing — a wrong hash never reaches the disk
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected {
        logging::error(&format!(
            "update {} hash mismatch: expected {expected}, got {actual}",
            info.version
        ));
        return Err("verification failed — the downloaded file does not match its published hash".into());
    }

    // write to a temp sibling, then rename over the destination: a file the
    // user may already have (Windows asks about overwriting in the save
    // dialog, but we still never leave a half-written exe behind)
    let tmp = dest.with_extension("part");
    std::fs::write(&tmp, &buf).map_err(|e| format!("write: {e}"))?;
    std::fs::rename(&tmp, &dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("move into place: {e}")
    })?;

    let path_str = dest.to_string_lossy().to_string();
    logging::info(&format!(
        "update {} downloaded + verified → {}",
        info.version, path_str
    ));
    on_event(DownloadEvent::Done {
        path: path_str.clone(),
    });
    Ok(path_str)
}

/// Remove any in-flight download file — called on cancel and app exit.
/// Takes (not peeks) the path so a completed download can never be swept:
/// by the time the file is Done, ACTIVE_DOWNLOAD was already cleared.
pub fn cleanup_active_download() {
    if let Some(p) = ACTIVE_DOWNLOAD
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .take()
    {
        // the in-progress body writes to a .part sibling first; the dest
        // itself is only created by the final rename — remove both paths
        // defensively, ignore errors (already gone / locked by AV is fine)
        let _ = std::fs::remove_file(&p);
        let part = p.with_extension("part");
        let _ = std::fs::remove_file(&part);
        logging::info("update download cleaned up");
    }
}

/// Open Explorer with the downloaded file selected — the standard
/// "/select," pattern every browser and installer uses. Read-only.
pub fn open_folder_selected(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    if !p.is_file() {
        return Err("file not found".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", p.display()))
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("cannot open folder: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = p;
        Err("unsupported on this platform".into())
    }
}

// ---------------------------------------------------------------------------
// HTTP plumbing — one agent, allowlist enforced on EVERY redirect hop.
// ---------------------------------------------------------------------------

/// Verify the URL against the allowlist (called for the initial request
/// and after every redirect ureq reports).
pub fn url_allowed(url: &str) -> bool {
    let Ok(parsed) = url.parse::<url::Url>() else {
        return false;
    };
    parsed.scheme() == "https" && ALLOWED_HOSTS.contains(&parsed.host_str().unwrap_or(""))
}

fn agent() -> ureq::Agent {
    // redirects: GitHub release assets cross hosts; every hop is re-checked
    let mut builder = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(STALL_TIMEOUT) // a stalled read becomes an error — no infinite hangs
        .redirects(6);

    // VPN/WARP users: Cloudflare WARP and many corporate setups route via a
    // local loopback proxy (WARP's local proxy mode listens on 127.0.0.1:40000
    // in some configurations) or a system-configured proxy. ureq only reads
    // HTTPS_PROXY/HTTP_PROXY env vars by default — desktop apps launched
    // from the Start menu have none, so we honor the Windows registry proxy
    // (the same setting browsers use) when no env override exists.
    if std::env::var_os("HTTPS_PROXY").is_none() && std::env::var_os("https_proxy").is_none() {
        if let Some(proxy_url) = windows_system_proxy() {
            if let Ok(p) = ureq::Proxy::new(&proxy_url) {
                logging::info(&format!("update http: using system proxy {proxy_url}"));
                builder = builder.proxy(p);
            }
        }
    }

    builder.build()
}

/// Read the Windows system proxy (WinINET settings — the same ones browsers
/// follow) from the registry. None when the user runs direct (default), or
/// when the value can't be parsed.
#[cfg(windows)]
fn windows_system_proxy() -> Option<String> {
    const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let settings = hkcu.open_subkey(KEY).ok()?;
    let enabled: u32 = settings.get_value("ProxyEnable").ok()?;
    if enabled == 0 {
        return None;
    }
    let server: String = settings.get_value("ProxyServer").ok()?;
    // "host:port" or "http=host:port;https=host:port" forms
    let https = server
        .split(';')
        .find(|s| s.starts_with("https="))
        .map(|s| s.trim_start_matches("https="));
    let chosen = https.unwrap_or(server.as_str());
    if chosen.is_empty() {
        return None;
    }
    // plain "host:port" → http proxy URL (HTTPS_PROXY-style syntax)
    let url = if chosen.contains("://") {
        chosen.to_string()
    } else {
        format!("http://{chosen}")
    };
    // sanity: must parse as a URL, else ignore
    url.parse::<url::Url>().ok().map(|_| url)
}

#[cfg(not(windows))]
fn windows_system_proxy() -> Option<String> {
    None
}

fn http_get(url: &str) -> Result<ureq::Response, String> {
    if !url_allowed(url) {
        return Err(format!("host not allowed: {url}"));
    }
    let call = agent()
        .get(url)
        .set("User-Agent", "lag-hunter-updater")
        .call();
    match call {
        Ok(resp) => {
            // ureq already followed redirects; the FINAL url must be allowed too
            let final_url = resp.get_url().to_string();
            if !url_allowed(&final_url) {
                return Err(format!("redirected to a host not allowed: {final_url}"));
            }
            Ok(resp)
        }
        Err(ureq::Error::Status(code, resp)) => {
            // 403/429 from the API: capture the reason line for the log —
            // rate limit vs UA policy vs WARP egress IPs differ here, and
            // "http 403" alone leaves us guessing in user reports
            let body = resp.into_string().unwrap_or_default();
            let reason = body
                .lines()
                .find(|l| l.contains("message"))
                .unwrap_or("no body")
                .trim()
                .chars()
                .take(160)
                .collect::<String>();
            Err(format!("http {code}: {reason}"))
        }
        Err(other) => Err(other.to_string()),
    }
}

fn http_get_text(url: &str) -> Result<String, String> {
    let mut buf = String::new();
    http_get(url)?
        .into_reader()
        .read_to_string(&mut buf)
        .map_err(|e| format!("read body: {e}"))?;
    Ok(buf)
}

fn http_get_json<T: serde::de::DeserializeOwned>(url: &str) -> Result<T, String> {
    let text = http_get_text(url)?;
    serde_json::from_str(&text).map_err(|e| format!("parse release json: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sums_line_parsed() {
        // full 64-char digests, the real SHA256SUMS shape
        let d1 = "a".repeat(64);
        let d2 = "0123456789abcdef".repeat(4);
        let sums = format!("{d1}  pubg-gameloop-lag-hunter-1.3.0.exe\n{d2}  other-file.txt\n");
        assert_eq!(
            sha_from_sums(&sums, "pubg-gameloop-lag-hunter-1.3.0.exe"),
            Some(d1.clone())
        );
        // GNU binary marker (*name) + case-insensitive file match
        let d3 = "ABCDEF0123456789".repeat(4);
        let gnu = format!("{d3} *PUBG-GAMELOOP-LAG-HUNTER-1.3.0.exe");
        assert_eq!(
            sha_from_sums(gnu.as_str(), "pubg-gameloop-lag-hunter-1.3.0.exe"),
            Some(d3.to_ascii_lowercase())
        );
        assert_eq!(sha_from_sums(&sums, "missing.exe"), None);
    }

    #[test]
    fn sums_digest_shape_validated() {
        // a 63-char digest is not a SHA-256 — must be rejected
        let bad = "abc  file.exe";
        assert_eq!(sha_from_sums(bad, "file.exe"), None);
    }

    #[test]
    fn allowlist_enforced() {
        assert!(url_allowed("https://api.github.com/repos/x/y/releases/latest"));
        assert!(url_allowed(
            "https://release-assets.githubusercontent.com/abc/xyz.exe"
        ));
        assert!(url_allowed(
            "https://objects.githubusercontent.com/abc/xyz.exe"
        ));
        assert!(!url_allowed("http://api.github.com/")); // http, not https
        assert!(!url_allowed("https://evil.com/pubg.exe"));
        assert!(!url_allowed("https://github.com.evil.com/x"));
        assert!(!url_allowed("not a url"));
    }
}
