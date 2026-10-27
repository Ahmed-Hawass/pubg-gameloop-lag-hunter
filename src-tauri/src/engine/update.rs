// update.rs - the update path: check GitHub, download the release exe,
// verify it against the published SHA256SUMS, hand the file to the user.
//
// SCOPE (deliberate, matches the tool's portable nature): no self-replace,
// no auto-restart. The most this module ever does is put a VERIFIED file
// next to the user and open its folder - the double-click is the user's.
//
// Security rules:
//   * hosts are allowlisted exactly like open_url - https only, GitHub only
//   * the downloaded exe MUST match the SHA-256 published in SHA256SUMS.txt
//     (this is the real protection: files fetched by an HTTP client get no
//     Mark-of-the-Web, so SmartScreen will NOT warn when the user runs it)
//   * the update window shows short bullets from the release's notes.json
//     asset (engine-bounded, plain text, never HTML); the full notes live
//     on the project site, opened in the browser
//
// Everything runs on the blocking pool (spawn_blocking from lib.rs) and
// logs every step: check → found → download start/pct/verified/failed -
// a stuck update is diagnosable from the log alone.

use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::logging;

// ---------------------------------------------------------------------------
// Allowlist - the same philosophy as OPEN_URL_ALLOWED_HOSTS in lib.rs.
// Downloads redirect across these hosts; anything else is refused.
//
// NOTE (4 vs 4): this list has 4 hosts on purpose: the 2 GitHub hosts
// shared with lib.rs plus the 2 release-asset CDN hosts below, because
// asset downloads redirect onto the CDN. The browser-open path in lib.rs
// has its own 4 (the GitHub hosts, the support link, and the project
// site) and never targets the CDN directly. Keep both lists https-only.
// ---------------------------------------------------------------------------

pub const ALLOWED_HOSTS: [&str; 4] = [
    "api.github.com",
    "github.com",
    "objects.githubusercontent.com", // legacy release asset host
    "release-assets.githubusercontent.com", // current release asset host
];

const RELEASES_LATEST_URL: &str =
    "https://api.github.com/repos/Ahmed-Hawass/pubg-gameloop-lag-hunter/releases/latest";

/// Hard bounds - "bounded everything" applies to downloads too.
const MAX_DOWNLOAD_BYTES: u64 = 60 * 1024 * 1024; // 60 MB: release exe is ~5-8 MB
const MAX_METADATA_BYTES: u64 = 2 * 1024 * 1024; // release JSON + checksum list
const STALL_TIMEOUT: Duration = Duration::from_secs(30); // no bytes for 30s = cancel

/// The update window's short-bullet bounds (notes.json): the release
/// notes ask writers to stay inside the same limits, enforced here
/// because the file is remote data.
const NOTES_MAX_BULLETS: usize = 4;
const NOTES_MAX_CHARS: usize = 140;

/// The project site's changelog page: the full, player-facing notes. A
/// version's anchor is its number with dots as dashes (the site's own
/// anchorOf format), so "2.0.2" links to "#v-2-0-2".
const NOTES_PAGE_BASE: &str = "https://laghunter.vercel.app/changelog";

/// What the UI needs to know about a newer release.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    /// e.g. "1.3.0" (tag stripped of the v prefix)
    pub version: String,
    /// short update-window highlights from the release's notes.json
    /// asset, per language, plain text never HTML. Bounded here (at most
    /// NOTES_MAX_BULLETS lines of at most NOTES_MAX_CHARS chars each);
    /// empty means the UI shows the notes link alone.
    pub notes_en: Vec<String>,
    pub notes_ar: Vec<String>,
    /// the project site's changelog entry for this version (full notes)
    pub notes_url: String,
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

/// The fields of releases/latest we need. The release body is
/// deliberately NOT read: the update window shows the short notes.json
/// bullets, the body stays on GitHub as the full technical record.
#[derive(Deserialize)]
struct GithubRelease {
    #[serde(default)]
    tag_name: String,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

/// The notes.json release asset: short bilingual highlights written in
/// the release session. `version` guards against a stale upload: a
/// mismatch means the file describes another release and is ignored
/// wholesale.
#[derive(Deserialize)]
struct GithubNotesFile {
    #[serde(default)]
    version: String,
    #[serde(default)]
    en: Vec<String>,
    #[serde(default)]
    ar: Vec<String>,
}

/// Ask GitHub for the latest release. Ok(None) = no newer version / no
/// release at all. Errors are logged and swallowed - a failed check must
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
    match build_info(&release, &version) {
        Ok(info) => {
            // the engine keeps what it resolved: the download path reuses
            // it instead of asking GitHub a second time (a rate-limited
            // shared IP must not fail a download the check just proved
            // reachable)
            *RESOLVED.lock().unwrap_or_else(|p| p.into_inner()) = Some(info.clone());
            logging::info(&format!(
                "update available: {} (asset {})",
                info.version, info.asset_name
            ));
            Some(info)
        }
        Err(e) => {
            logging::warn(&format!("update {version} refused: {e}"));
            None
        }
    }
}

/// Clean a version string into the shape the updater and the settings
/// file expect: digits and dots only, at most 32 characters, no "v"
/// prefix. Returns None when nothing usable is left.
///
/// The clamp lives HERE (not only in the settings loader) so an unbounded
/// string can never reach the settings file in the first place.
pub fn clean_version(raw: &str) -> Option<String> {
    let clean: String = raw
        .trim()
        .trim_start_matches('v')
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.')
        .take(32)
        .collect();
    if clean.is_empty() {
        None
    } else {
        Some(clean)
    }
}

/// The release the engine resolved last, from its OWN GitHub fetch. The
/// download path reuses it, so the common flow costs ONE api call and not
/// two: a rate-limited shared IP (GitHub answers 403/429 to many users
/// behind the same NAT) must not fail a download the check just proved
/// reachable. The cache is engine-side and engine-filled: the frontend's
/// copy of the URLs is never used, whatever it says.
static RESOLVED: Mutex<Option<UpdateInfo>> = Mutex::new(None);

/// Resolve ONE release BY VERSION, straight from GitHub. The download path
/// uses this instead of trusting the caller's copy of the URLs: the caller
/// says WHICH version it wants, the engine says WHERE the file comes from.
/// A buggy or compromised UI can therefore never point the download at its
/// own asset with its own checksum file beside it.
pub fn resolve_release(version: &str) -> Result<UpdateInfo, String> {
    let _t = logging::timed("update: resolve release");
    let clean = clean_version(version).ok_or("update version is not valid")?;
    // the release this engine already resolved for that exact version
    let cached = RESOLVED
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
        .filter(|i| i.version == clean);
    if let Some(info) = cached {
        logging::info(&format!(
            "update release resolved from the engine cache: {clean}"
        ));
        return Ok(info);
    }
    let url = format!(
        "https://api.github.com/repos/Ahmed-Hawass/pubg-gameloop-lag-hunter/releases/tags/v{clean}"
    );
    let release: GithubRelease = http_get_json(&url)?;
    build_info(&release, &clean)
}

/// Build the update info from a release the engine fetched itself. Every
/// URL in the result comes from that release - never from the caller.
fn build_info(release: &GithubRelease, version: &str) -> Result<UpdateInfo, String> {
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
        return Err(format!(
            "assets incomplete (exe: {}, sums: {})",
            asset.is_some(),
            sums.is_some()
        ));
    };
    // short notes are presentation data: any failure (missing asset,
    // network, malformed file, stale version) degrades to the link-only
    // body and must never fail the update itself
    let notes_asset = release
        .assets
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case("notes.json"));
    let (notes_en, notes_ar) = notes_asset
        .and_then(|a| fetch_notes(&a.browser_download_url, version))
        .unwrap_or_default();
    Ok(UpdateInfo {
        version: version.to_string(),
        notes_en,
        notes_ar,
        notes_url: notes_page_url(version),
        asset_url: asset.browser_download_url.clone(),
        asset_name: asset.name.clone(),
        sums_url: sums.browser_download_url.clone(),
    })
}

/// Bound one language's bullet list: trim, drop empties, cap the count,
/// truncate overlong lines by chars (never bytes: Arabic is multi-byte).
fn sanitize_notes(lines: Vec<String>) -> Vec<String> {
    lines
        .into_iter()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .take(NOTES_MAX_BULLETS)
        .map(|l| {
            if l.chars().count() > NOTES_MAX_CHARS {
                let cut: String = l.chars().take(NOTES_MAX_CHARS - 1).collect();
                format!("{cut}…")
            } else {
                l
            }
        })
        .collect()
}

/// Parse a notes.json body against the release it must describe. Pure,
/// so the guards (stale version, malformed, empty) are unit-tested.
/// None = unusable: the UI falls back to the notes link alone.
fn parse_notes(text: &str, version: &str) -> Option<(Vec<String>, Vec<String>)> {
    let raw: GithubNotesFile = serde_json::from_str(text).ok()?;
    if raw.version.trim().trim_start_matches('v') != version {
        return None;
    }
    let (en, ar) = (sanitize_notes(raw.en), sanitize_notes(raw.ar));
    if en.is_empty() && ar.is_empty() {
        return None;
    }
    Some((en, ar))
}

/// Fetch one release's notes.json. Failures are logged and degrade to
/// None (link-only body): notes are never worth failing an update over.
fn fetch_notes(url: &str, version: &str) -> Option<(Vec<String>, Vec<String>)> {
    let text = match http_get_text(url) {
        Ok(t) => t,
        Err(e) => {
            logging::info(&format!("update notes unavailable: {e}"));
            return None;
        }
    };
    let notes = parse_notes(&text, version);
    if notes.is_none() {
        logging::info("update notes ignored (malformed, stale version, or empty)");
    }
    notes
}

/// The site changelog URL for a version, following the site's own anchor
/// format (dots become dashes).
fn notes_page_url(version: &str) -> String {
    format!("{NOTES_PAGE_BASE}#v-{}", version.replace('.', "-"))
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/// Global cancel flag - one download at a time; a second request while one
/// is running is refused (the UI's modal is the only trigger).
static DOWNLOAD_RUNNING: AtomicBool = AtomicBool::new(false);
/// The path of the file being written - cleaned up on cancel/exit.
static ACTIVE_DOWNLOAD: Mutex<Option<std::path::PathBuf>> = Mutex::new(None);
/// The current download's cancel handle (set at download start, taken on end).
static ACTIVE_CANCEL: Mutex<Option<std::sync::Arc<AtomicBool>>> = Mutex::new(None);
/// The path of the last file this module VERIFIED and wrote, exactly as
/// the caller received it. It is the ONLY path the "open its folder"
/// action may open: the command used to accept any existing absolute path
/// over IPC. The STRING is stored (not the PathBuf) so the comparison is
/// byte-exact with what the UI holds.
static LAST_VERIFIED: Mutex<Option<String>> = Mutex::new(None);

/// Wire the cancel handle of a starting download (called by the command).
/// Refused while a download is already running: registering over a live
/// download would DROP the first one's Arc (the only cancel path it has),
/// leaving it running but uncancellable - app exit could no longer stop
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
        // format: digest then whitespace then the file name (may be *name in GNU mode).
        // A malformed line (no whitespace at all) is skipped, never fatal: one
        // junk line must not abort the scan for the asset listed further down.
        let Some((digest, name)) = line.split_once(char::is_whitespace) else {
            continue;
        };
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

/// Resolve the expected digest for an asset: an empty checksum list is its
/// own honest, retryable error (the fetch came back hollow, not a trust
/// verdict on the asset), distinct from a genuine name miss below.
fn expected_digest(sums_text: &str, asset_name: &str) -> Result<String, String> {
    if sums_text.trim().is_empty() {
        return Err("checksum list came back empty - try again".into());
    }
    sha_from_sums(sums_text, asset_name).ok_or_else(|| {
        format!("asset {asset_name} not listed in SHA256SUMS.txt - refusing unverified download")
    })
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
/// then written to disk - a partial/failed file never touches the path
/// the user chose.
///
/// `version` is a REQUEST: the release is resolved HERE, from GitHub, so
/// the asset URLs and the expected file name come from the engine's own
/// answer and never from the caller.
///
/// The resolve lives INSIDE this function on purpose: the cancel slot the
/// command registered before the call must be released on EVERY exit path,
/// and a failed resolve (offline, a rate limit) is one of them. Resolving
/// outside left the slot occupied, and every later attempt was refused
/// with "already registered" until the app was restarted.
pub fn download_and_verify(
    version: &str,
    dest: std::path::PathBuf,
    cancel: &AtomicBool,
    on_event: impl Fn(DownloadEvent) + Send + 'static,
) -> Result<String, String> {
    if DOWNLOAD_RUNNING.swap(true, Ordering::SeqCst) {
        return Err("a download is already running".into());
    }
    let result = match resolve_release(version) {
        Ok(info) => {
            // validate the destination while DOWNLOAD_RUNNING is held: a bad
            // path can never even register a cleanup entry (validate_dest
            // never writes).
            match validate_dest(&dest, &info.asset_name) {
                Ok(()) => download_inner(&info, dest, cancel, &on_event),
                Err(e) => Err(e),
            }
        }
        Err(e) => {
            logging::info(&format!("update release not resolved: {e}"));
            Err(e)
        }
    };
    // the cancel slot is cleared on every exit path: register_cancel ran
    // before this call (lib.rs), so an early return without clearing would
    // leave the slot occupied and every retry would fail with "already
    // registered".
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

    // fetch the sums first - if we can't verify, we don't download at all
    let sums_text = http_get_text(&info.sums_url)?;
    logging::info(&format!("update sums: {} bytes", sums_text.len()));
    let expected = expected_digest(&sums_text, &info.asset_name)?;

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

    // a hollow download (the same 200-empty shape as the sums quirk) must
    // never reach the hash compare disguised as a "mismatch"
    if buf.is_empty() {
        return Err("download came back empty - try again".into());
    }

    // verify BEFORE writing - a wrong hash never reaches the disk
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected {
        logging::error(&format!(
            "update {} hash mismatch: expected {expected}, got {actual}",
            info.version
        ));
        return Err(
            "verification failed - the downloaded file does not match its published hash".into(),
        );
    }

    // write to a namespaced temp sibling, then rename over the
    // destination: our extension can never be a user's own file (and a
    // file the user may already have at dest is only ever replaced by
    // the verified rename - Windows asks about overwriting in the save
    // dialog, but we still never leave a half-written exe behind)
    let tmp = part_sibling(&dest);
    std::fs::write(&tmp, &buf).map_err(|e| format!("write: {e}"))?;
    std::fs::rename(&tmp, &dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("move into place: {e}")
    })?;

    let path_str = dest.to_string_lossy().to_string();
    *LAST_VERIFIED.lock().unwrap_or_else(|p| p.into_inner()) = Some(path_str.clone());
    logging::info(&format!(
        "update {} downloaded + verified → {}",
        info.version, path_str
    ));
    on_event(DownloadEvent::Done {
        path: path_str.clone(),
    });
    Ok(path_str)
}

/// Remove any in-flight download PARTIAL - called on cancel and app exit.
/// Takes (not peeks) the path so a completed download can never be swept:
/// by the time the file is Done, ACTIVE_DOWNLOAD was already cleared.
/// The in-progress body writes to our namespaced sibling; the DEST
/// itself is only ever created by the final verified rename - so cleanup
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

/// Open Explorer with the downloaded file selected - the standard
/// "/select," pattern every browser and installer uses. Read-only.
///
/// Scope: ONLY the file this module verified and wrote. The path is
/// compared against the last verified download, so the command cannot be
/// used to reveal an arbitrary file on the machine (it used to accept any
/// existing absolute path over IPC).
///
/// Quote-unsafe characters are refused outright: explorer re-parses its raw
/// command line, so an embedded quote could break out of the /select
/// argument. `raw_arg` with a validated, quote-free path keeps the
/// argument boundary intact.
pub fn open_folder_selected(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    if !p.is_file() {
        return Err("file not found".into());
    }
    if !p.is_absolute() {
        return Err("path must be absolute".into());
    }
    let verified = LAST_VERIFIED
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone();
    match verified {
        Some(v) if v == path => {}
        _ => {
            return Err("path is not the verified download".into());
        }
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
// HTTP plumbing - one agent, allowlist enforced on EVERY redirect hop.
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
        .timeout_read(STALL_TIMEOUT) // a stalled read becomes an error - no infinite hangs
        .redirects(0);

    // VPN/WARP users: Cloudflare WARP and many corporate setups route via a
    // local loopback proxy (WARP's local proxy mode listens on 127.0.0.1:40000
    // in some configurations) or a system-configured proxy. ureq only reads
    // HTTPS_PROXY/HTTP_PROXY env vars by default - desktop apps launched
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

/// Read the Windows system proxy (WinINET settings - the same ones browsers
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

/// Decide whether a `200` response is actually an unfolded redirect: GitHub's
/// download endpoint answers some non-browser HTTP stacks with `200` plus a
/// `Location` header and a proven-empty body instead of a 302 (observed Oct
/// 2026: `content-length: 0` alongside the signed CDN URL). Pure: follow
/// ONLY when emptiness is proven by an explicit `content-length: 0` - a
/// real body (any length, or an unknown streamed length) is never hijacked.
fn empty_body_redirect(location: Option<&str>, content_length: Option<&str>) -> Option<String> {
    let loc = location.unwrap_or("").trim();
    if !loc.is_empty() && content_length.unwrap_or("").trim() == "0" {
        Some(loc.to_string())
    } else {
        None
    }
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
            Ok(resp) => {
                // the 200-empty quirk above is a redirect wearing a success
                // code: follow it like the 3xx below (still allowlisted,
                // still hop-bounded), never hand an empty body downstream
                if let Some(target) =
                    empty_body_redirect(resp.header("Location"), resp.header("content-length"))
                {
                    let next = current
                        .parse::<url::Url>()
                        .and_then(|base| base.join(&target))
                        .map_err(|e| format!("invalid redirect location: {e}"))?;
                    logging::info("update http: following empty-200 redirect");
                    current = next.to_string();
                    continue;
                }
                return Ok(resp);
            }
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
                // 403/429 from the API: capture the reason line for the log -
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
        // a 63-char digest is not a SHA-256 - must be rejected
        let bad = "abc  file.exe";
        assert_eq!(sha_from_sums(bad, "file.exe"), None);
    }

    #[test]
    fn sums_skips_malformed_lines() {
        // one junk line (no whitespace separator) above the real entry must
        // not abort the scan: the asset lower down is still found
        let d = "a".repeat(64);
        let sums = format!("garbage-line-with-no-separator\n{d}  file.exe\n");
        assert_eq!(sha_from_sums(&sums, "file.exe"), Some(d.clone()));
        // a trailing junk line after the real entry changes nothing either
        let sums = format!("{d}  file.exe\ntrailing-junk");
        assert_eq!(sha_from_sums(&sums, "file.exe"), Some(d));
    }

    #[test]
    fn empty_body_redirect_follows_proven_empty_only() {
        let loc = "https://release-assets.githubusercontent.com/x/SHA256SUMS.txt?sig=abc";
        // the observed quirk: 200 + Location + proven-empty body
        assert_eq!(
            empty_body_redirect(Some(loc), Some("0")),
            Some(loc.to_string())
        );
        // a real body is never hijacked …
        assert_eq!(empty_body_redirect(Some(loc), Some("187")), None);
        // … nor is an unknown (possibly streamed) length …
        assert_eq!(empty_body_redirect(Some(loc), None), None);
        // … and Location alone, without proven emptiness, stays put
        assert_eq!(empty_body_redirect(None, Some("0")), None);
        assert_eq!(empty_body_redirect(Some("   "), Some("0")), None);
    }

    #[test]
    fn expected_digest_names_the_failure_honestly() {
        let d = "a".repeat(64);
        let sums = format!("{d}  pubg-gameloop-lag-hunter-2.0.0.exe\n");
        assert_eq!(
            expected_digest(&sums, "pubg-gameloop-lag-hunter-2.0.0.exe"),
            Ok(d.clone())
        );
        // hollow fetch: honest and retryable, never a trust verdict
        assert_eq!(
            expected_digest("", "pubg-gameloop-lag-hunter-2.0.0.exe"),
            Err("checksum list came back empty - try again".into())
        );
        assert_eq!(
            expected_digest("   \r\n", "pubg-gameloop-lag-hunter-2.0.0.exe"),
            Err("checksum list came back empty - try again".into())
        );
        // non-empty but nameless: genuine refusal, wording unchanged
        assert!(expected_digest(&sums, "other.exe")
            .unwrap_err()
            .contains("not listed"));
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
    fn notes_parsed_and_bounded() {
        let body = r#"{
            "version": "2.0.2",
            "en": ["  first  ", "", "second", "third", "fourth", "fifth"],
            "ar": ["الأول"]
        }"#;
        let (en, ar) = parse_notes(body, "2.0.2").unwrap();
        // trimmed, empties dropped, capped at NOTES_MAX_BULLETS
        assert_eq!(en, vec!["first", "second", "third", "fourth"]);
        assert_eq!(ar, vec!["الأول"]);
    }

    #[test]
    fn notes_stale_version_ignored() {
        // the stale-upload guard: a file describing another release is
        // ignored wholesale, whatever it contains
        let stale = r#"{ "version": "2.0.1", "en": ["old"], "ar": [] }"#;
        assert_eq!(parse_notes(stale, "2.0.2"), None);
        // the v prefix is tolerated on either side of the comparison
        let v = r#"{ "version": "v2.0.2", "en": ["ok"], "ar": [] }"#;
        assert!(parse_notes(v, "2.0.2").is_some());
        // a missing version field can never match
        let missing = r#"{ "en": ["no version"], "ar": [] }"#;
        assert_eq!(parse_notes(missing, "2.0.2"), None);
    }

    #[test]
    fn notes_malformed_or_empty_degrade_to_none() {
        assert_eq!(parse_notes("not json", "2.0.2"), None);
        assert_eq!(
            parse_notes(r#"{ "version": "2.0.2", "en": [], "ar": [] }"#, "2.0.2"),
            None
        );
        assert_eq!(
            parse_notes(
                r#"{ "version": "2.0.2", "en": ["   "], "ar": [] }"#,
                "2.0.2"
            ),
            None
        );
    }

    #[test]
    fn notes_truncate_by_chars_not_bytes() {
        // 250 Arabic chars: the cut lands at NOTES_MAX_CHARS chars total
        // (139 + the ellipsis), never a byte split mid-character
        let long = "علامة".repeat(50);
        let body = format!(r#"{{ "version": "2.0.2", "en": [], "ar": ["{long}"] }}"#);
        let (_, ar) = parse_notes(&body, "2.0.2").unwrap();
        assert_eq!(ar[0].chars().count(), NOTES_MAX_CHARS);
        assert!(ar[0].ends_with('…'));
    }

    #[test]
    fn notes_page_url_uses_the_site_anchor() {
        assert_eq!(
            notes_page_url("2.0.2"),
            "https://laghunter.vercel.app/changelog#v-2-0-2"
        );
    }

    /// The version that reaches the settings file must be a short, sane
    /// string: an unbounded one grew the file for as long as the app ran.
    #[test]
    fn version_is_cleaned_before_it_is_stored() {
        assert_eq!(clean_version("2.0.2").as_deref(), Some("2.0.2"));
        assert_eq!(clean_version("v2.0.2").as_deref(), Some("2.0.2"));
        assert_eq!(clean_version("  2.0.2  ").as_deref(), Some("2.0.2"));
        // anything that is not a version shape is dropped
        assert_eq!(clean_version(""), None);
        assert_eq!(clean_version("   "), None);
        assert_eq!(clean_version("v"), None);
        // the length is capped
        let long = "9".repeat(200);
        assert_eq!(clean_version(&long).unwrap().len(), 32);
        // stray characters are filtered, not carried into the file
        let cleaned = clean_version("2.0.2/../../evil").unwrap();
        assert!(
            cleaned.chars().all(|c| c.is_ascii_digit() || c == '.'),
            "no letters or separators may survive: {cleaned}"
        );
        assert!(cleaned.starts_with("2.0.2"));
    }

    /// The engine keeps what it resolved, and the download path reuses it:
    /// one api call for the common flow, not two (a rate-limited shared IP
    /// must not fail a download the check just proved reachable).
    #[test]
    fn the_resolved_release_is_reused_without_a_second_call() {
        let info = UpdateInfo {
            version: "9.9.9".into(),
            notes_en: Vec::new(),
            notes_ar: Vec::new(),
            notes_url: notes_page_url("9.9.9"),
            asset_url: "https://github.com/owner/repo/app.exe".into(),
            asset_name: "app-9.9.9.exe".into(),
            sums_url: "https://github.com/owner/repo/SHA256SUMS.txt".into(),
        };
        *RESOLVED.lock().unwrap_or_else(|p| p.into_inner()) = Some(info.clone());
        // the cached release answers without touching the network (an
        // offline machine still gets the right URLs)
        let resolved = resolve_release("9.9.9").expect("the cached release answers");
        assert_eq!(resolved.asset_url, info.asset_url);
        assert_eq!(resolved.asset_name, info.asset_name);
        assert_eq!(resolved.sums_url, info.sums_url);
        // another version is NOT answered from the cache
        assert!(
            resolve_release("1.2.3").is_err(),
            "a different version must be resolved from GitHub, not the cache"
        );
        *RESOLVED.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }

    /// The engine builds the release's own URLs: a caller cannot hand it a
    /// file of its own. The release it builds from is the one GitHub
    /// returned, and the asset must be the versioned exe plus the sums.
    #[test]
    fn build_info_takes_every_url_from_the_release() {
        let release = GithubRelease {
            tag_name: "v2.0.2".into(),
            assets: vec![
                GithubAsset {
                    name: "pubg-gameloop-lag-hunter-2.0.2.exe".into(),
                    browser_download_url: "https://github.com/owner/repo/releases/download/v2.0.2/pubg-gameloop-lag-hunter-2.0.2.exe".into(),
                },
                GithubAsset {
                    name: "SHA256SUMS.txt".into(),
                    browser_download_url: "https://github.com/owner/repo/releases/download/v2.0.2/SHA256SUMS.txt".into(),
                },
            ],
        };
        let info = build_info(&release, "2.0.2").expect("a complete release");
        assert_eq!(info.version, "2.0.2");
        assert_eq!(info.asset_name, "pubg-gameloop-lag-hunter-2.0.2.exe");
        assert!(info
            .asset_url
            .contains("pubg-gameloop-lag-hunter-2.0.2.exe"));
        assert!(info.sums_url.ends_with("SHA256SUMS.txt"));
        assert!(info.notes_url.contains("v-2-0-2"));
    }

    /// A release without the exe or without the sums is refused: a
    /// half-present release is not an update.
    #[test]
    fn build_info_refuses_an_incomplete_release() {
        let no_sums = GithubRelease {
            tag_name: "v2.0.2".into(),
            assets: vec![GithubAsset {
                name: "pubg-gameloop-lag-hunter-2.0.2.exe".into(),
                browser_download_url: "https://github.com/owner/repo/x.exe".into(),
            }],
        };
        assert!(build_info(&no_sums, "2.0.2").is_err());
        let no_exe = GithubRelease {
            tag_name: "v2.0.2".into(),
            assets: vec![GithubAsset {
                name: "SHA256SUMS.txt".into(),
                browser_download_url: "https://github.com/owner/repo/SHA256SUMS.txt".into(),
            }],
        };
        assert!(build_info(&no_exe, "2.0.2").is_err());
    }

    /// "Open its folder" opens ONLY the file this module verified. It used
    /// to accept any existing absolute path over IPC.
    #[test]
    fn open_folder_refuses_a_path_we_never_verified() {
        let dir = std::env::temp_dir().join(format!(
            "laghunter-open-folder-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let verified = dir.join("verified.exe");
        let other = dir.join("other.exe");
        std::fs::write(&verified, b"x").expect("write");
        std::fs::write(&other, b"x").expect("write");
        *LAST_VERIFIED.lock().unwrap_or_else(|p| p.into_inner()) =
            Some(verified.to_string_lossy().to_string());
        // the file we verified opens
        assert!(open_folder_selected(&verified.to_string_lossy()).is_ok());
        // any other existing file is refused
        let err = open_folder_selected(&other.to_string_lossy()).unwrap_err();
        assert!(
            err.contains("not the verified download"),
            "an unverified path must be refused (got {err})"
        );
        *LAST_VERIFIED.lock().unwrap_or_else(|p| p.into_inner()) = None;
        let _ = std::fs::remove_dir_all(&dir);
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
        // at the path is fine - cleanup only ever removes our namespaced
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
        // the version cannot resolve (it is not a version shape at all, so
        // the refusal happens locally, with no network call): the call
        // fails BEFORE any path is touched, and the cancel slot must still
        // be released - otherwise every later attempt is refused
        let bad = std::path::PathBuf::from("relative.exe");
        assert!(download_and_verify("not-a-version", bad, &cancel, |_| {}).is_err());
        assert!(
            ACTIVE_CANCEL
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .is_none(),
            "cancel slot must be cleared on a failed resolve"
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
        // alone - including a user's own plain ".part" file next door
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
