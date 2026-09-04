// engine/mod.rs — the brain: sampling, detection, diagnosis, session, storage, settings, logging, system
pub mod detector;
pub mod diagnoser;
pub mod logging;
pub mod sampler;
pub mod session;
pub mod settings;
pub mod storage;
pub mod system;
pub mod types;

/// The one true version string — set by tauri-build from tauri.conf.json
/// (releases are tagged by hand when attaching to a GitHub release). Read
/// this instead of hardcoding "1.0.0" in yet another place.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
