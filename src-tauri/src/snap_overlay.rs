// snap_overlay.rs — the native snap-layouts hit target over our custom
// maximize button.
//
// Windows shows the snap-layouts flyout only when the cursor sits over a
// maximize button the OS itself can see (a WM_NCHITTEST answer of
// HTMAXBUTTON). Our caption buttons are HTML inside the WebView2 child
// window, so the OS never sees them and no DOM, CSS, or Tauri setting can
// bring the flyout back (Tauri #4531 stays open upstream; winit exposes no
// hit-test API for this). The application-level answer every working
// solution uses: one small transparent native child window sitting exactly
// over our maximize button. It never paints, so our design shows through
// untouched; it owns the mouse in that one rectangle, so hover, leave, and
// click come back to the frontend as events and the button keeps its own
// behavior (toggle, tooltip, keyboard, focus ring).
//
// Technique note (the sampler.rs rule): this uses generated windows-sys
// bindings — the same linking Tauri itself uses — never a hand-written
// extern block (the banned technique that once crashed webview creation).
// Geometry always comes from the frontend's own measurement (DOM rect +
// devicePixelRatio), so RTL mirroring, zoom, and DPI need no special
// cases here. Creation happens lazily on the main thread after the
// webview exists (far from the boot sequence), and every failure degrades
// to Ok: the app simply behaves as it does today, without a flyout.

/// Frontend-measured maximize-button rect (CSS px) plus the scale that
/// turns it into physical pixels. RTL-safe by construction: the frontend
/// measures where the button really is, so no side assumption lives here.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
pub struct SnapOverlayRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

/// Physical rect (Some) or hide (None): a sub-pixel hit area would catch
/// stray hovers, so anything that rounds down to nothing hides instead.
fn physical_rect(rect: &SnapOverlayRect) -> Option<(i32, i32, i32, i32)> {
    if rect.scale <= 0.0 || rect.width < 1.0 || rect.height < 1.0 {
        return None;
    }
    let x = (rect.x * rect.scale).round() as i32;
    let y = (rect.y * rect.scale).round() as i32;
    let w = (rect.width * rect.scale).round() as i32;
    let h = (rect.height * rect.scale).round() as i32;
    if w < 1 || h < 1 {
        return None;
    }
    Some((x, y, w, h))
}

#[cfg(windows)]
mod win {
    use super::{physical_rect, SnapOverlayRect};
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use tauri::{Emitter, Manager, WebviewWindow};
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        Graphics::Gdi::{GetStockObject, HBRUSH, NULL_BRUSH},
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT},
            WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, RegisterClassExW, SetWindowPos, ShowWindow,
                CS_HREDRAW, CS_VREDRAW, HTMAXBUTTON, HWND_TOP, SWP_NOACTIVATE, SW_HIDE, SW_SHOWNA,
                WM_NCDESTROY, WM_NCHITTEST, WM_NCLBUTTONDOWN, WM_NCLBUTTONUP, WM_NCMOUSELEAVE,
                WM_NCMOUSEMOVE, WNDCLASSEXW, WS_CHILD, WS_CLIPSIBLINGS, WS_OVERLAPPED, WS_VISIBLE,
            },
        },
    };

    const CLASS_NAME: &[u16] = &[
        b'L' as u16,
        b'a' as u16,
        b'g' as u16,
        b'H' as u16,
        b'u' as u16,
        b'n' as u16,
        b't' as u16,
        b'e' as u16,
        b'r' as u16,
        b'S' as u16,
        b'n' as u16,
        b'a' as u16,
        b'p' as u16,
        0,
    ];

    const EVENT_ENTER: &str = "snap-overlay-enter";
    const EVENT_LEAVE: &str = "snap-overlay-leave";
    const EVENT_CLICK: &str = "snap-overlay-click";

    struct Overlay {
        child: isize,
        hovering: bool,
        pressing: bool,
        app: tauri::AppHandle,
    }

    // keyed by parent HWND: one overlay per window (this app owns one).
    // isize + AppHandle are Send, so the map crosses threads safely.
    static OVERLAYS: OnceLock<Mutex<HashMap<isize, Overlay>>> = OnceLock::new();

    fn overlays() -> &'static Mutex<HashMap<isize, Overlay>> {
        OVERLAYS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    static REGISTERED: std::sync::Once = std::sync::Once::new();

    unsafe fn register_class() {
        REGISTERED.call_once(|| unsafe {
            let class = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(overlay_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: GetModuleHandleW(std::ptr::null()),
                hIcon: std::ptr::null_mut(),
                hIconSm: std::ptr::null_mut(),
                hCursor: std::ptr::null_mut(),
                // NULL brush: erase paints nothing, WM_PAINT draws nothing —
                // invisibility comes from never painting, never from layering
                // (WS_EX_LAYERED would cost the hit test we exist for).
                hbrBackground: GetStockObject(NULL_BRUSH) as HBRUSH,
                lpszMenuName: std::ptr::null(),
                lpszClassName: CLASS_NAME.as_ptr(),
            };
            RegisterClassExW(&class);
        });
    }

    fn parent_hwnd(window: &WebviewWindow) -> Result<isize, String> {
        let handle = window
            .window_handle()
            .map_err(|e| format!("snap overlay: no window handle ({e})"))?;
        match handle.as_raw() {
            RawWindowHandle::Win32(h) => Ok(h.hwnd.get()),
            _ => Err("snap overlay: not a Win32 window".into()),
        }
    }

    unsafe fn sync_on_main(
        parent: isize,
        app: tauri::AppHandle,
        rect: Option<(i32, i32, i32, i32)>,
    ) {
        register_class();
        // Poison recovers, like every other lock in this codebase: a panic
        // while the lock was held must not kill the app (the release profile
        // aborts on panic, so an expect() here would take the whole window
        // down from inside the WndProc).
        let mut map = overlays().lock().unwrap_or_else(|p| p.into_inner());
        let entry = map.entry(parent).or_insert_with(|| {
            let child = CreateWindowExW(
                0,
                CLASS_NAME.as_ptr(),
                std::ptr::null(),
                WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_OVERLAPPED,
                0,
                0,
                0,
                0,
                parent as HWND,
                std::ptr::null_mut(),
                GetModuleHandleW(std::ptr::null()),
                std::ptr::null(),
            );
            Overlay {
                child: child as isize,
                hovering: false,
                pressing: false,
                app: app.clone(),
            }
        });
        entry.app = app;
        if entry.child == 0 {
            return;
        }
        match rect {
            Some((x, y, w, h)) => {
                SetWindowPos(entry.child as HWND, HWND_TOP, x, y, w, h, SWP_NOACTIVATE);
                ShowWindow(entry.child as HWND, SW_SHOWNA);
            }
            None => {
                entry.hovering = false;
                entry.pressing = false;
                ShowWindow(entry.child as HWND, SW_HIDE);
            }
        }
    }

    /// Move (or hide, on None) the snap overlay. Always Ok: any failure
    /// here must degrade to today's behavior (no flyout), never an error
    /// surface or a half-built native child.
    pub fn sync_overlay(
        window: &WebviewWindow,
        rect: Option<SnapOverlayRect>,
    ) -> Result<(), String> {
        let parent = parent_hwnd(window)?;
        let app = window.app_handle().clone();
        let physical = rect.as_ref().and_then(physical_rect);
        window
            .run_on_main_thread(move || unsafe { sync_on_main(parent, app, physical) })
            .map_err(|e| format!("snap overlay: cannot reach the main thread ({e})"))?;
        Ok(())
    }

    unsafe fn child_state(child: HWND) -> Option<*mut Overlay> {
        let map = overlays().lock().unwrap_or_else(|p| p.into_inner());
        map.values()
            .find(|o| o.child == child as isize)
            .map(|o| o as *const Overlay as *mut Overlay)
    }

    unsafe fn track_leave(child: HWND) {
        let mut tme = TRACKMOUSEEVENT {
            cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
            dwFlags: TME_LEAVE | TME_NONCLIENT,
            hwndTrack: child,
            dwHoverTime: 0,
        };
        TrackMouseEvent(&mut tme);
    }

    unsafe extern "system" fn overlay_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_NCHITTEST => {
                // THE flyout answer: over our maximize button, the OS sees
                // a native maximize button. Hover enter rides along (the
                // webview never sees this mouse, so the button's own
                // :hover cannot fire — the frontend mirrors it from the
                // enter/leave events instead).
                if let Some(state) = child_state(hwnd) {
                    if !(*state).hovering {
                        (*state).hovering = true;
                        let _ = (*state).app.emit(EVENT_ENTER, ());
                    }
                    track_leave(hwnd);
                }
                return HTMAXBUTTON as LRESULT;
            }
            WM_NCMOUSEMOVE => {
                // re-arm enter on every move (a missed leave, e.g. across
                // a DPI jump, heals on the next move instead of sticking).
                if let Some(state) = child_state(hwnd) {
                    if !(*state).hovering {
                        (*state).hovering = true;
                        let _ = (*state).app.emit(EVENT_ENTER, ());
                    }
                    track_leave(hwnd);
                }
                return 0;
            }
            WM_NCMOUSELEAVE => {
                if let Some(state) = child_state(hwnd) {
                    (*state).hovering = false;
                    (*state).pressing = false;
                    let _ = (*state).app.emit(EVENT_LEAVE, ());
                }
                return 0;
            }
            WM_NCLBUTTONDOWN => {
                // swallow: the click completes (or cancels) on button-up,
                // like every native caption button.
                if let Some(state) = child_state(hwnd) {
                    (*state).pressing = true;
                }
                return 0;
            }
            WM_NCLBUTTONUP => {
                if let Some(state) = child_state(hwnd) {
                    let click = (*state).pressing;
                    (*state).pressing = false;
                    // the app owns what a click DOES (toggle): this layer
                    // only reports that one happened, complete with a
                    // press that started here.
                    if click {
                        let _ = (*state).app.emit(EVENT_CLICK, ());
                    }
                }
                return 0;
            }
            WM_NCDESTROY => {
                let mut map = overlays().lock().unwrap_or_else(|p| p.into_inner());
                map.retain(|_, o| o.child != hwnd as isize);
            }
            _ => {}
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

#[cfg(not(windows))]
mod win {
    use super::SnapOverlayRect;

    pub fn sync_overlay(
        _window: &tauri::WebviewWindow,
        _rect: Option<SnapOverlayRect>,
    ) -> Result<(), String> {
        Ok(())
    }
}

/// Position (or hide) the snap-layout overlay. Never fails loudly: the
/// worst case is today's behavior, without a flyout.
#[tauri::command]
pub fn sync_snap_overlay(
    window: tauri::WebviewWindow,
    rect: Option<SnapOverlayRect>,
) -> Result<(), String> {
    win::sync_overlay(&window, rect)
}

#[cfg(test)]
mod tests {
    use super::{physical_rect, SnapOverlayRect};

    fn rect(x: f64, y: f64, w: f64, h: f64, scale: f64) -> SnapOverlayRect {
        SnapOverlayRect {
            x,
            y,
            width: w,
            height: h,
            scale,
        }
    }

    #[test]
    fn scales_css_px_to_physical_with_rounding() {
        // 46px button at 125%: 57.5 rounds to 58, never truncates short.
        assert_eq!(
            physical_rect(&rect(408.0, 0.0, 46.0, 44.0, 1.25)),
            Some((510, 0, 58, 55))
        );
    }

    #[test]
    fn unity_scale_passes_through() {
        assert_eq!(
            physical_rect(&rect(92.0, 0.0, 46.0, 44.0, 1.0)),
            Some((92, 0, 46, 44))
        );
    }

    #[test]
    fn zero_or_negative_scale_hides() {
        assert_eq!(physical_rect(&rect(0.0, 0.0, 46.0, 44.0, 0.0)), None);
        assert_eq!(physical_rect(&rect(0.0, 0.0, 46.0, 44.0, -1.0)), None);
    }

    #[test]
    fn sub_pixel_hit_area_hides() {
        // a hidden (display:none) button measures 0: no dead hit area.
        assert_eq!(physical_rect(&rect(0.0, 0.0, 0.0, 0.0, 1.25)), None);
        assert_eq!(physical_rect(&rect(0.0, 0.0, 0.4, 44.0, 1.0)), None);
    }

    #[test]
    fn rtl_mirror_needs_no_special_case() {
        // RTL only moves WHERE the button is; the frontend measures the
        // real rect, so the same path covers both directions.
        assert_eq!(
            physical_rect(&rect(92.0, 0.0, 46.0, 44.0, 1.5)),
            Some((138, 0, 69, 66))
        );
    }
}
