// tray.rs - the notification-area icon: the app's second face.
//
// The window is not the app. Closing it now hides it (the X button keeps
// its one honest meaning: get this off my screen) and the icon stays behind
// as the only way back: Open, Quick scan, Exit. Three items, nothing else.
// A fourth item would be where this starts becoming a second interface with
// its own bugs; the menu is a shortcut, not a place to live.
//
// Two faces, ONE copy source: the native menu is born here with EMPTY
// labels and the frontend pushes the localized text (tray_set_labels) on
// mount and on every language switch. Copy keeps living in src/locales like
// every other user-facing string, so the en/ar parity test still guards it.
// An empty label can only ever be seen inside the first second of a launch,
// and only by a user who right-clicks the icon that early.
//
// Exit is NOT a quit here. It only emits an event and the frontend runs
// the exit gate: quiet work quits silently (no window flash), in-flight
// work reveals the window first and then names itself in one confirm
// instead of being dropped. The real quit is begin_quit + window.close():
// the CloseRequested handler in lib.rs lets a close through ONLY while
// that flag is set, so every other close the backend sees (the taskbar
// button; Alt+F4 is intercepted by the frontend gate) is a hide. The X
// button never reaches this menu: it hides directly.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::engine;

/// The app's main window label (tauri.conf.json), shared with lib.rs.
pub const MAIN_WINDOW: &str = "main";
/// One icon per app; tray_by_id finds it again for every label/tooltip push.
const TRAY_ID: &str = "main";

/// Baked tray variants at 32px (the size Windows shows at 200%, scaling
/// down cleanly to 16px at 100%): gray while idle, brand colors while a
/// scan measures. Rendered from the brand artwork variants, never
/// hand-drawn; the build fails if either file goes missing.
const ICON_IDLE: &[u8] = include_bytes!("../icons/tray-idle-32.png");
const ICON_BUSY: &[u8] = include_bytes!("../icons/tray-busy-32.png");

/// Decode one baked variant. Kept fallible so a corrupt bake degrades to
/// the app icon instead of taking the tray (or the app) down with it.
fn variant_image(busy: bool) -> tauri::Result<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(if busy { ICON_BUSY } else { ICON_IDLE })
}

/// Swap the icon between idle gray and busy green. Missing-tray is Ok (the
/// window path still works without an icon), anything else surfaces to the
/// command logger.
pub fn set_busy<R: Runtime>(app: &AppHandle<R>, busy: bool) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    tray.set_icon(Some(variant_image(busy)?))?;
    Ok(())
}

/// Menu item ids. Stable machine keys like every other cross-boundary string.
const ID_OPEN: &str = "open";
const ID_SCAN: &str = "quick_scan";
const ID_EXIT: &str = "exit";

/// Pushed to the frontend when the user picks Quick scan.
pub const EVENT_QUICK_SCAN: &str = "tray://quick-scan";
/// Pushed to the frontend when the user picks Exit.
pub const EVENT_EXIT: &str = "tray://exit";

/// Set once, right before the real close. Sticky on purpose: the flag is
/// never cleared, because a quit that half-happened must not fall back to
/// "hide" and leave the user staring at a taskbar with no window.
static QUITTING: AtomicBool = AtomicBool::new(false);

/// Arm the real quit (called by the quit_app command, never by the menu).
pub fn begin_quit() {
    QUITTING.store(true, Ordering::SeqCst);
}

/// Is this close a real quit (and not a hide)?
pub fn is_quitting() -> bool {
    QUITTING.load(Ordering::SeqCst)
}

/// What a clicked menu id means. Split out from the handler so the routing
/// is testable without a window (the ids are the whole contract).
#[derive(Debug, PartialEq, Eq)]
enum MenuAction {
    /// reveal the window, nothing else
    Open,
    /// emit only: the frontend starts silently or reveals when it needs eyes
    QuickScan,
    /// emit only: the frontend quits silently or reveals-then-asks
    Exit,
    /// an id we do not own (never happens; cheap to ignore)
    Unknown,
}

fn action_for(id: &str) -> MenuAction {
    match id {
        ID_OPEN => MenuAction::Open,
        ID_SCAN => MenuAction::QuickScan,
        ID_EXIT => MenuAction::Exit,
        _ => MenuAction::Unknown,
    }
}

/// Bring the window back: un-minimize, show, focus. All three, in that
/// order - `show()` on a minimized window brings back a minimized window,
/// and a window that comes back without focus looks broken to the user who
/// just asked for it. Failures are ignored: this runs on a tray click where
/// there is no dialog to report into.
pub fn reveal<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Live handles to the three menu items. A label push mutates their text in
/// place: the scan item carries the live percent and moves in ~5% steps, so
/// rebuilding the native menu on every push is wasted work with a real cost
/// on the tray's main thread. The ids are stable, the items are clones of
/// the handles the menu owns, and the tray stays the one owner of the menu.
struct TrayItems<R: Runtime> {
    open: MenuItem<R>,
    scan: MenuItem<R>,
    exit: MenuItem<R>,
}

/// Create the icon at startup. The labels arrive right after (frontend push);
/// every failure is logged and swallowed, because a missing icon must never
/// take the app down with it - the window path still works without one.
pub fn build<R: Runtime>(app: &AppHandle<R>) {
    let built = (|| -> tauri::Result<()> {
        let open = MenuItem::with_id(app, ID_OPEN, "", true, None::<&str>)?;
        let scan = MenuItem::with_id(app, ID_SCAN, "", true, None::<&str>)?;
        let exit = MenuItem::with_id(app, ID_EXIT, "", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open, &scan, &exit])?;
        let mut builder = TrayIconBuilder::with_id(TRAY_ID)
            .menu(&menu)
            // left click reveals the window (the icon is the app's home
            // button, like every tray tool); the menu belongs to the right
            // button, which is where Windows users look for it
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    ..
                } = event
                {
                    reveal(tray.app_handle());
                }
            });
        // the idle-gray bake first (a corrupt bake falls back to the app
        // icon, never to no icon: the tray must exist even on a bad bake)
        match variant_image(false) {
            Ok(icon) => {
                builder = builder.icon(icon);
            }
            Err(e) => {
                engine::logging::warn(&format!("tray baked icon bad ({e}), using app icon"));
                if let Some(icon) = app.default_window_icon() {
                    builder = builder.icon(icon.clone());
                }
            }
        }
        builder.build(app)?;
        // keep the handles for in-place re-labeling; the tray now owns the
        // menu itself, these are the same native items
        let _ = app.manage(TrayItems { open, scan, exit });
        Ok(())
    })();
    match built {
        Ok(()) => engine::logging::info("tray icon created"),
        Err(e) => engine::logging::warn(&format!("tray icon unavailable: {e}")),
    }
}

fn on_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match action_for(id) {
        MenuAction::Open => {
            engine::logging::info("tray: open");
            reveal(app);
        }
        MenuAction::QuickScan => {
            engine::logging::info("tray: quick scan");
            // no reveal here: a quick scan starts silently while hidden and
            // the tooltip carries the live percent. The frontend reveals the
            // window only when it needs eyes (a start failure, or a state
            // that is already waiting to be read).
            let _ = app.emit(EVENT_QUICK_SCAN, ());
        }
        MenuAction::Exit => {
            engine::logging::info("tray: exit");
            // no reveal here either: the frontend decides. Quiet work quits
            // without flashing the window back, in-flight work reveals first
            // and then asks in a visible confirm.
            let _ = app.emit(EVENT_EXIT, ());
        }
        MenuAction::Unknown => {}
    }
}

/// Re-label the menu in place (language switch, live scan percent). The tray
/// must already be built: no tray or no managed items means there is nothing
/// visible to update, which is Ok, not an error.
pub fn set_labels<R: Runtime>(
    app: &AppHandle<R>,
    open: &str,
    scan: &str,
    exit: &str,
) -> tauri::Result<()> {
    let Some(_tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let Some(items) = app.try_state::<TrayItems<R>>() else {
        return Ok(());
    };
    items.open.set_text(open)?;
    items.scan.set_text(scan)?;
    items.exit.set_text(exit)?;
    Ok(())
}

/// The tray tooltip: the live scan percent while a scan runs, a done line
/// while a verdict waits unread, the app name otherwise. Windows caps
/// tooltips at 128 characters, which no composed string here can reach.
pub fn set_tooltip<R: Runtime>(app: &AppHandle<R>, text: &str) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    tray.set_tooltip(Some(text))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_menu_id_routes_to_its_action() {
        assert_eq!(action_for(ID_OPEN), MenuAction::Open);
        assert_eq!(action_for(ID_SCAN), MenuAction::QuickScan);
        assert_eq!(action_for(ID_EXIT), MenuAction::Exit);
    }

    #[test]
    fn an_unknown_id_is_ignored_not_panicked() {
        assert_eq!(action_for("something-else"), MenuAction::Unknown);
        assert_eq!(action_for(""), MenuAction::Unknown);
    }

    #[test]
    fn baked_variants_decode_at_tray_size() {
        // a corrupt or wrong-size bake must fail here, not on a user
        // machine with a missing or blurry tray icon
        for busy in [false, true] {
            let img = variant_image(busy).expect("tray bake must decode");
            assert_eq!((img.width(), img.height()), (32, 32));
        }
    }

    #[test]
    fn the_quit_flag_arms_once_and_stays() {
        // the flag is process-wide and sticky by design, so assert the
        // contract (a hide is never a quit) rather than the exact value:
        // any other test in this binary that armed it first still holds.
        if is_quitting() {
            return;
        }
        assert!(!is_quitting());
        begin_quit();
        assert!(is_quitting());
    }
}
