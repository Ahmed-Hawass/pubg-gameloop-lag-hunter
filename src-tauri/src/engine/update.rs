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
//
// NOTE (4 vs 3): this list has 4 hosts on purpose: the 2 GitHub hosts
// shared with lib.rs plus the 2 release-asset CDN hosts below, because
// asset downloads redirect onto the CDN. The browser-open path in lib.rs
// never targets the CDN directly, so it stays at 3. Keep both https-only.
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
const MAX_METADATA_BYTES: u64 = 2 * 1024 * 1024; // release JSON + checksum list
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
/// Refused while a download is already running: registering over a live
/// download would DROP the first one's Arc (the only cancel path it has),
/// leaving it running but uncancellable — app exit could no longer stop
/// it. The command layer's "one modal" rule is UI convention; THIS is the
/// engine's own enforcement.
pub fn register_cancel(cancel: std::sync::Arc<AtomicBool>) -> Result<(), String> {
    let mut slot = ACTIVE_CANCEL.lock().unwrap_or_else(|p| p.into_inner());
    if slot.is_some() {
        return Err("a download is already registered".into());
    }
    *slot = Some(cancel);
    Ok(())
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

/// Validate the download destination BEFORE anything is written. The path
/// comes over IPC from the webview (the save dialog's result), so it gets
/// the same distrust every other IPC path receives:
///   * it must be an absolute path (a bare file name would land in the CWD)
///   * the PARENT directory must already exist (the save dialog guarantees
///     this on its own; a mismatched path is refused, not created)
///   * the destination itself must NOT be a directory
///
/// Note: we do NOT require the destination to be inside any app-owned folder
/// (the user explicitly chose it), but the file name must equal the asset
/// we verified (a compromised IPC path can never redirect the verified
/// bytes over an arbitrary user file), and cleanup only ever removes our
/// namespaced temp sibling.
fn validate_dest(dest: &std::path::Path, expected_name: &str) -> Result<(), String> {
    if !dest.is_absolute() {
        return Err("download path must be absolute".into());
    }
    if expected_name.is_empty()
        || !expected_name.ends_with(".exe")
        || expected_name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
    {
        return Err("update asset name is not valid".into());
    }
    let Some(file_name) = dest.file_name().and_then(|n| n.to_str()) else {
        return Err("download path has no file name".into());
    };
    if file_name != expected_name {
        return Err("download file name must match the verified asset".into());
    }
    if dest
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("download path must not contain ..".into());
    }
    let Some(parent) = dest.parent() else {
        return Err("download path has no parent folder".into());
    };
    if !parent.is_dir() {
        return Err(format!(
            "download folder does not exist: {}",
            parent.display()
        ));
    }
    if dest.is_dir() {
        return Err("download path is a folder, not a file".into());
    }
    Ok(())
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
    // validate the destination while DOWNLOAD_RUNNING is held: a bad path
    // can never even register a cleanup entry (validate_dest never writes).
    // Clearing ACTIVE_CANCEL here is required: register_cancel ran before
    // this call (lib.rs), so an early return without clearing would leave
    // the slot occupied and every retry would fail with "already registered".
    if let Err(e) = validate_dest(&dest, &info.asset_name) {
        DOWNLOAD_RUNNING.store(false, Ordering::SeqCst);
        *ACTIVE_CANCEL.lock().unwrap_or_else(|p| p.into_inner()) = None;
        return Err(e);
    }
    let result = download_inner(info, dest, cancel, &on_event);
    DOWNLOAD_RUNNING.store(false, Ordering::SeqCst);
    *ACTIVE_DOWNLOAD.lock().unwrap_or_else(|p| p.into_inner()) = None;
    *ACTIVE_CANCEL.lock().unwrap_or_else(|p| p.into_inner()) = None;
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
        return Err(format!(
            "download exceeds the {MAX_DOWNLOAD_BYTES}-byte cap"
        ));
    }
    *ACTIVE_DOWNLOAD.lock().unwrap_or_else(|p| p.into_inner()) = Some(dest.clone());
    let mut hasher = Sha256::new();
    let mut body = resp.into_reader();
    let mut buf = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    let mut last_event = std::time::Instant::now();
    loop {
        if cancel.load(Ordering::SeqCst) {
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
            return Err(format!(
                "download exceeds the {MAX_DOWNLOAD_BYTES}-byte cap"
            ));
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

    // a cancel landing after the last read still wins: the user closed
    // the modal, so nothing gets verified or saved afterwards
    if cancel.load(Ordering::SeqCst) {
        return Err("cancelled".into());
    }

    // verify BEFORE writing — a wrong hash never reaches the disk
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected {
        logging::error(&format!(
            "update {} hash mismatch: expected {expected}, got {actual}",
            info.version
        ));
        return Err(
            "verification failed — the downloaded file does not match its published hash".into(),
        );
    }

    // write to a namespaced temp sibling, then rename over the
    // destination: our extension can never be a user's own file (and a
    // file the user may already have at dest is only ever replaced by
    // the verified rename — Windows asks about overwriting in the save
    // dialog, but we still never leave a half-written exe behind)
    let tmp = part_sibling(&dest);
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

/// Remove any in-flight download PARTIAL — called on cancel and app exit.
/// Takes (not peeks) the path so a completed download can never be swept:
/// by the time the file is Done, ACTIVE_DOWNLOAD was already cleared.
/// The in-progress body writes to our namespaced sibling; the DEST
/// itself is only ever created by the final verified rename — so cleanup
/// removes ONLY that sibling. A file the user already had anywhere,
/// under any extension, is never touched by a cancelled/failed download.
pub fn cleanup_active_download() {
    if let Some(p) = ACTIVE_DOWNLOAD
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .take()
    {
        let _ = std::fs::remove_file(part_sibling(&p));
        logging::info("update download partial cleaned up");
    }
}

/// Temp sibling for a download destination: our own extension, so cleanup
/// can never mistake a user's file for our partial (a plain ".part" file
/// could already belong to the user). Pure.
fn part_sibling(dest: &std::path::Path) -> std::path::PathBuf {
    dest.with_extension("laghunter-part")
}

/// Open Explorer with the downloaded file selected — the standard
/// "/select," pattern every browser and installer uses. Read-only.
///
/// Honest scope: this accepts ANY existing absolute file (it only checks
/// presence, absoluteness, and quote-safety), not just a file this module
/// verified and wrote. Callers pass the freshly verified download, but the
/// function itself performs no provenance check — it is a read-only
/// reveal, never a trust assertion.
/// Callers pass the file just verified and written (validate_dest ran
/// before the download); the existence check below establishes presence
/// only, not provenance. Quote-unsafe characters are refused outright:
/// explorer re-parses its raw command line, so an embedded quote could
/// break out of the /select argument. `raw_arg` with a validated,
/// quote-free path keeps the argument boundary intact.
pub fn open_folder_selected(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    if !p.is_file() {
        return Err("file not found".into());
    }
    if !p.is_absolute() {
        return Err("path must be absolute".into());
    }
    // one quote check: the old second condition (any backslash segment
    // containing a quote) was subsumed by the first and never added anything
    if path.contains('"') {
        return Err("path contains characters Explorer cannot select safely".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new(super::system::explorer_exe())
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
    // Redirects are resolved by http_get so each Location is allowlisted
    // before the next request is made.
    let mut builder = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(STALL_TIMEOUT) // a stalled read becomes an error — no infinite hangs
        .redirects(0);

    // VPN/WARP users: Cloudflare WARP and many corporate setups route via a
    // local loopback proxy (WARP's local proxy mode listens on 127.0.0.1:40000
    // in some configurations) or a system-configured proxy. ureq only reads
    // HTTPS_PROXY/HTTP_PROXY env vars by default — desktop apps launched
    // from the Start menu have none, so we honor the Windows registry proxy
    // (the same setting browsers use) when no env override exists.
    if std::env::var_os("HTTPS_PROXY").is_none() && std::env::var_os("https_proxy").is_none() {
        if let Some(proxy_url) = windows_system_proxy() {
            if let Ok(p) = ureq::Proxy::new(&proxy_url) {
                logging::info(&format!(
                    "update http: using system proxy {}",
                    redact_proxy(&proxy_url)
                ));
                builder = builder.proxy(p);
            }
        }
    }

    builder.build()
}

/// Proxy URL with credentials stripped for logs: `user:pass@host` must
/// never reach the flight recorder. Pure.
fn redact_proxy(url: &str) -> String {
    match url.rsplit_once('@') {
        Some((_, host)) => format!("<redacted>@{host}"),
        None => url.to_string(),
    }
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
    let mut current = url.to_string();
    for _ in 0..=6 {
        if !url_allowed(&current) {
            return Err(format!("host not allowed: {current}"));
        }
        let call = agent()
            .get(&current)
            .set("User-Agent", "lag-hunter-updater")
            .call();
        match call {
            Ok(resp) => return Ok(resp),
            Err(ureq::Error::Status(code, resp)) if (300..400).contains(&code) => {
                let Some(location) = resp.header("Location") else {
                    return Err(format!("redirect {code} has no Location header"));
                };
                let next = current
                    .parse::<url::Url>()
                    .and_then(|base| base.join(location))
                    .map_err(|e| format!("invalid redirect location: {e}"))?;
                current = next.to_string();
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
                return Err(format!("http {code}: {reason}"));
            }
            Err(other) => return Err(other.to_string()),
        }
    }
    Err("too many redirects".into())
}

fn http_get_text(url: &str) -> Result<String, String> {
    let mut bytes = Vec::new();
    http_get(url)?
        .into_reader()
        .take(MAX_METADATA_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("read body: {e}"))?;
    if bytes.len() as u64 > MAX_METADATA_BYTES {
        return Err(format!(
            "metadata exceeds the {MAX_METADATA_BYTES}-byte cap"
        ));
    }
    String::from_utf8(bytes).map_err(|e| format!("metadata is not UTF-8: {e}"))
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
        assert!(url_allowed(
            "https://api.github.com/repos/x/y/releases/latest"
        ));
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

    #[test]
    fn dest_validation_refuses_bad_paths() {
        let asset = "laghunter-dest-test.exe";
        // relative path → refused (would land in the CWD)
        assert!(validate_dest(std::path::Path::new("update.exe"), asset).is_err());
        // no parent → refused
        assert!(validate_dest(std::path::Path::new("\\update.exe"), asset).is_err());
        // parent folder doesn't exist → refused
        assert!(validate_dest(
            std::path::Path::new("Z:\\definitely-not-a-real-folder-9f3a\\update.exe"),
            asset
        )
        .is_err());
        // a directory as destination → refused
        assert!(validate_dest(std::path::Path::new("C:\\Windows"), asset).is_err());
        // name must equal the verified asset (no overwriting thesis.docx
        // with verified bytes through a compromised IPC path)
        let other = std::env::temp_dir().join("thesis.docx");
        assert!(validate_dest(&other, asset).is_err());
        // .. in the path → refused
        let dotdot = std::env::temp_dir().join("..").join(asset);
        assert!(validate_dest(&dotdot, asset).is_err());
        // a real folder + the exact asset name → accepted (existing FILE
        // at the path is fine — cleanup only ever removes our namespaced
        // sibling)
        let tmp = std::env::temp_dir().join(asset);
        assert!(validate_dest(&tmp, asset).is_ok());
    }

    #[test]
    fn part_sibling_is_namespaced_to_us() {
        let dest = std::path::Path::new("C:\\dl\\update.exe");
        assert_eq!(
            part_sibling(dest),
            std::path::PathBuf::from("C:\\dl\\update.laghunter-part")
        );
    }

    #[test]
    fn proxy_redact_strips_credentials() {
        assert_eq!(
            redact_proxy("http://user:pass@proxy.example:8080"),
            "<redacted>@proxy.example:8080"
        );
        assert_eq!(
            redact_proxy("http://proxy.example:8080"),
            "http://proxy.example:8080"
        );
    }

    #[test]
    fn failed_validate_frees_cancel_slot_for_retry() {
        // register then fail validation: the slot must be freed so the
        // next download can register (a stuck slot blocked every retry
        // until restart or manual Cancel).
        use std::sync::Arc;
        // ensure a clean slate (a previous failed test must not leak)
        *ACTIVE_CANCEL.lock().unwrap_or_else(|p| p.into_inner()) = None;
        DOWNLOAD_RUNNING.store(false, Ordering::SeqCst);
        let cancel = Arc::new(AtomicBool::new(false));
        register_cancel(cancel.clone()).unwrap();
        let info = UpdateInfo {
            version: "0.0.0-test".into(),
            notes: String::new(),
            asset_url: "https://github.com/x/y.exe".into(),
            asset_name: "laghunter-retry-test.exe".into(),
            sums_url: "https://github.com/x/sums.txt".into(),
        };
        // relative path always fails validation without touching the net
        let bad = std::path::PathBuf::from("relative.exe");
        assert!(download_and_verify(&info, bad, &cancel, |_| {}).is_err());
        assert!(
            ACTIVE_CANCEL
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .is_none(),
            "cancel slot must be cleared on validate failure"
        );
        assert!(!DOWNLOAD_RUNNING.load(Ordering::SeqCst));
        // retry must be able to register again
        let cancel2 = Arc::new(AtomicBool::new(false));
        assert!(register_cancel(cancel2).is_ok());
        // cleanup for other tests
        *ACTIVE_CANCEL.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }

    #[test]
    fn cleanup_removes_part_sibling_only() {
        // simulate a registered download over PRE-EXISTING user files:
        // cleanup must remove our sibling and leave everything else
        // alone — including a user's own plain ".part" file next door
        let dir = std::env::temp_dir();
        let dest = dir.join("laghunter-cleanup-test-existing.txt");
        let ours = dir.join("laghunter-cleanup-test-existing.laghunter-part");
        let theirs = dir.join("laghunter-cleanup-test-existing.part");
        std::fs::write(&dest, "user's own file").unwrap();
        std::fs::write(&ours, "partial bytes").unwrap();
        std::fs::write(&theirs, "user's own partial").unwrap();
        *ACTIVE_DOWNLOAD.lock().unwrap_or_else(|p| p.into_inner()) = Some(dest.clone());
        cleanup_active_download();
        assert!(!ours.exists(), "our sibling must be removed");
        assert!(
            dest.exists(),
            "the pre-existing destination file must NOT be deleted"
        );
        assert!(
            theirs.exists(),
            "a user's own .part file must NOT be deleted"
        );
        let _ = std::fs::remove_file(&dest);
        let _ = std::fs::remove_file(&theirs);
    }
}
