// window_state.rs — remembered main-window geometry: pure rules only.
//
// The window opens at the config default (tauri.conf.json) unless the user
// customized it before: outer size, position and the maximized flag persist
// in settings.json and are reapplied before first show. All Tauri calls
// (monitors, live rect) stay in lib.rs; everything decidable from numbers
// lives here and is unit-tested.
//
// Every fit lands inside a work area, never inside a raw monitor rect: the
// difference between the two is the taskbar (and any other reserved edge),
// and a window that opens under the taskbar is exactly what this module
// exists to prevent.

use serde::{Deserialize, Serialize};

/// remembered outer geometry in physical pixels (matches outer_size /
/// outer_position, so no DPI math anywhere on the restore path).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WinRect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// One monitor as the restore path needs it. `full` is the whole screen and
/// decides WHICH monitor a window belongs to (the one holding most of it);
/// `work` is that screen minus the taskbar and every other reserved edge,
/// and is the box the window must end up inside.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Screen {
    pub full: WinRect,
    pub work: WinRect,
}

/// floor mirrors the window minimums in tauri.conf.json (minWidth /
/// minHeight): a restored window never opens smaller than the UI supports.
pub const MIN_W: u32 = 500;
pub const MIN_H: u32 = 400;
/// absurd saved dims (hand-edited file, corrupt JSON): larger than any
/// real display — treated as "no geometry", never applied.
const MAX_DIM: u32 = 7680;
/// where Windows parks a minimized window, with an iconic size beside it
/// (199 by 34 at 125% scaling on the machine this was found on).
const ICONIC_ORIGIN: i32 = -32000;

/// Reject anything we could never show: zero or absurd dims, the iconic
/// rect of a minimized window (stored by mistake, it reopened a
/// minimum-size window in the corner), and anything below the window
/// minimums. Pure.
pub fn sane_rect(r: WinRect) -> bool {
    r.w > 0
        && r.h > 0
        && r.w <= MAX_DIM
        && r.h <= MAX_DIM
        && r.w >= MIN_W
        && r.h >= MIN_H
        && !(r.x == ICONIC_ORIGIN && r.y == ICONIC_ORIGIN)
}

/// What to persist after a move/resize event: a maximized window keeps
/// its pre-maximize rect and raises the flag (the maximized footprint
/// itself must never be stored, or "restore" would reopen a
/// fake-maximized window); a normal window stores its live rect and
/// clears the flag. Pure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoredGeom {
    pub rect: Option<WinRect>,
    pub maximized: bool,
}

/// The live rect to persist, or None when the window is minimized: it has
/// no real geometry then (Windows reports the iconic rect), and storing
/// that is what put a minimum-size window in the corner on the next
/// launch. The caller maps a failed `is_minimized` to minimized: losing
/// a remembered size costs nothing, a stranded window costs the window.
/// Pure.
pub fn storable_rect(minimized: bool, live: WinRect) -> Option<WinRect> {
    if minimized {
        None
    } else {
        Some(live)
    }
}

pub fn next_stored(old: StoredGeom, maximized_now: bool, live: WinRect) -> StoredGeom {
    if maximized_now {
        StoredGeom {
            rect: old.rect,
            maximized: true,
        }
    } else {
        StoredGeom {
            rect: Some(live),
            maximized: false,
        }
    }
}

/// What a fitted restore should hand back to settings: the fitted rect
/// whenever the fit changed anything, so a rect that was under the taskbar
/// (or parked half off-screen) stops being replayed on every later launch.
/// None = the stored rect already fits, leave settings untouched. Pure.
pub fn resave_after_fit(saved: Option<WinRect>, fitted: WinRect) -> Option<WinRect> {
    if saved == Some(fitted) {
        None
    } else {
        Some(fitted)
    }
}

/// Fit a saved rect onto the current monitors: pick the monitor holding
/// most of it (whole-screen overlap), shrink oversized dims to the work
/// area, then slide it until it sits inside that work area. None = nothing
/// usable (no monitors, or an insane rect): the caller centers the config
/// default instead. Pure.
pub fn fit_rect(saved: WinRect, screens: &[Screen]) -> Option<WinRect> {
    if !sane_rect(saved) || screens.is_empty() {
        return None;
    }
    let mut best = 0usize;
    let mut best_area: i64 = -1;
    for (i, s) in screens.iter().enumerate() {
        let area = overlap_area(saved, s.full);
        if area > best_area {
            best_area = area;
            best = i;
        }
    }
    let work = screens[best].work;
    let w = saved.w.min(work.w).max(MIN_W.min(work.w));
    let h = saved.h.min(work.h).max(MIN_H.min(work.h));
    let x = clamp_inside(saved.x as i64, w as i64, work.x as i64, work.w as i64);
    let y = clamp_inside(saved.y as i64, h as i64, work.y as i64, work.h as i64);
    Some(WinRect { x, y, w, h })
}

fn overlap_area(r: WinRect, m: WinRect) -> i64 {
    let x1 = (r.x as i64).max(m.x as i64);
    let y1 = (r.y as i64).max(m.y as i64);
    let x2 = (r.x as i64 + r.w as i64).min(m.x as i64 + m.w as i64);
    let y2 = (r.y as i64 + r.h as i64).min(m.y as i64 + m.h as i64);
    (x2 - x1).max(0) * (y2 - y1).max(0)
}

/// Keep [pos, pos+len] inside [mon, mon+mon_len], so a window parked half
/// off-screen (or under the taskbar) comes back whole. `len` is shrunk to
/// `mon_len` by the caller first, which is what makes a full fit always
/// possible and keeps these bounds from crossing.
fn clamp_inside(pos: i64, len: i64, mon: i64, mon_len: i64) -> i32 {
    pos.clamp(mon, mon + mon_len - len) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sane_accepts_normal_rects() {
        assert!(sane_rect(WinRect {
            x: 100,
            y: 100,
            w: 1180,
            h: 760
        }));
        assert!(sane_rect(WinRect {
            x: -2000,
            y: -500,
            w: 500,
            h: 400
        }));
    }

    #[test]
    fn sane_rejects_garbage() {
        assert!(!sane_rect(WinRect {
            x: 0,
            y: 0,
            w: 0,
            h: 760
        }));
        assert!(!sane_rect(WinRect {
            x: 0,
            y: 0,
            w: 1180,
            h: 0
        }));
        assert!(!sane_rect(WinRect {
            x: 0,
            y: 0,
            w: 99999,
            h: 760
        }));
        assert!(!sane_rect(WinRect {
            x: 0,
            y: 0,
            w: 1180,
            h: 99999
        }));
    }

    #[test]
    fn sane_rejects_the_iconic_rect_of_a_minimized_window() {
        // what settings.json held after a minimize-then-quit session:
        // stored as the remembered geometry, it opened a minimum-size
        // window in the corner on every launch after
        assert!(!sane_rect(WinRect {
            x: -32000,
            y: -32000,
            w: 199,
            h: 34
        }));
        // an off-screen window the user dragged there is still geometry
        assert!(sane_rect(WinRect {
            x: -2000,
            y: -500,
            w: 500,
            h: 400
        }));
    }

    #[test]
    fn sane_rejects_rects_below_the_window_minimums() {
        // the window cannot be this small, so this was never geometry
        assert!(!sane_rect(WinRect {
            x: 100,
            y: 100,
            w: MIN_W - 1,
            h: 400
        }));
        assert!(!sane_rect(WinRect {
            x: 100,
            y: 100,
            w: 500,
            h: MIN_H - 1
        }));
        // exactly the minimum is a real window the user can have
        assert!(sane_rect(WinRect {
            x: 100,
            y: 100,
            w: MIN_W,
            h: MIN_H
        }));
    }

    /// A screen with nothing reserved: what every secondary monitor looks
    /// like, and a primary with the taskbar on the other edge.
    fn plain(x: i32, y: i32, w: u32, h: u32) -> Screen {
        let full = WinRect { x, y, w, h };
        Screen { full, work: full }
    }

    /// The everyday case: a 1920x1080 screen with a 40px taskbar at the
    /// bottom, so the work area is 1920x1040.
    fn one_mon() -> Vec<Screen> {
        vec![Screen {
            full: WinRect {
                x: 0,
                y: 0,
                w: 1920,
                h: 1080,
            },
            work: WinRect {
                x: 0,
                y: 0,
                w: 1920,
                h: 1040,
            },
        }]
    }

    #[test]
    fn fit_keeps_inside_rects() {
        let r = WinRect {
            x: 100,
            y: 100,
            w: 1180,
            h: 760,
        };
        assert_eq!(fit_rect(r, &one_mon()), Some(r));
    }

    #[test]
    fn fit_shrinks_oversized_rects_to_the_work_area() {
        let back = fit_rect(
            WinRect {
                x: 0,
                y: 0,
                w: 4000,
                h: 2000,
            },
            &one_mon(),
        )
        .unwrap();
        // the work area, not the screen: 1080 would hide 40px of window
        // behind the taskbar
        assert_eq!((back.w, back.h), (1920, 1040));
        assert_eq!((back.x, back.y), (0, 0));
    }

    #[test]
    fn fit_pulls_offscreen_rects_back_whole() {
        let back = fit_rect(
            WinRect {
                x: -2000,
                y: 100,
                w: 1180,
                h: 760,
            },
            &one_mon(),
        )
        .unwrap();
        assert_eq!((back.x, back.y), (0, 100));
        let back = fit_rect(
            WinRect {
                x: 1900,
                y: 1000,
                w: 500,
                h: 400,
            },
            &one_mon(),
        )
        .unwrap();
        assert_eq!((back.x, back.y), (1420, 640));
    }

    #[test]
    fn fit_keeps_the_window_clear_of_the_taskbar() {
        // saved with its bottom edge 120px under the taskbar: it comes
        // back sitting exactly on the work area, never over the taskbar
        let back = fit_rect(
            WinRect {
                x: 100,
                y: 400,
                w: 1180,
                h: 760,
            },
            &one_mon(),
        )
        .unwrap();
        assert_eq!((back.x, back.y), (100, 280));
        assert_eq!(back.y + back.h as i32, 1040);
    }

    #[test]
    fn fit_clears_a_taskbar_on_the_side() {
        // vertical taskbar on the left edge: the work area starts at x=48
        let screens = vec![Screen {
            full: WinRect {
                x: 0,
                y: 0,
                w: 1920,
                h: 1080,
            },
            work: WinRect {
                x: 48,
                y: 0,
                w: 1872,
                h: 1080,
            },
        }];
        let back = fit_rect(
            WinRect {
                x: -40,
                y: 100,
                w: 1180,
                h: 760,
            },
            &screens,
        )
        .unwrap();
        assert_eq!((back.x, back.y), (48, 100));
    }

    #[test]
    fn fit_needs_monitors_and_sane_input() {
        let r = WinRect {
            x: 100,
            y: 100,
            w: 1180,
            h: 760,
        };
        assert_eq!(fit_rect(r, &[]), None);
        assert_eq!(
            fit_rect(
                WinRect {
                    x: 0,
                    y: 0,
                    w: 0,
                    h: 760
                },
                &one_mon()
            ),
            None
        );
    }

    #[test]
    fn fit_picks_the_monitor_holding_most_of_the_rect() {
        let screens = vec![plain(0, 0, 1920, 1080), plain(1920, 0, 1920, 1080)];
        let back = fit_rect(
            WinRect {
                x: 2000,
                y: 100,
                w: 1180,
                h: 760,
            },
            &screens,
        )
        .unwrap();
        assert_eq!((back.x, back.y), (2000, 100));
        // mostly off every screen: lands on the best overlap, inside it
        let back = fit_rect(
            WinRect {
                x: -1500,
                y: -900,
                w: 500,
                h: 400,
            },
            &screens,
        )
        .unwrap();
        assert_eq!((back.x, back.y), (0, 0));
    }

    #[test]
    fn fit_chooses_the_monitor_by_whole_screen_overlap() {
        // the saved rect sits under the first monitor's taskbar but
        // touches no other screen: it belongs to that monitor (whole
        // screen), and is then lifted clear of the taskbar
        let screens = vec![
            Screen {
                full: WinRect {
                    x: 0,
                    y: 0,
                    w: 1920,
                    h: 1080,
                },
                work: WinRect {
                    x: 0,
                    y: 0,
                    w: 1920,
                    h: 1040,
                },
            },
            plain(-1920, 0, 1920, 1080),
        ];
        let back = fit_rect(
            WinRect {
                x: 100,
                y: 1040,
                w: 500,
                h: 400,
            },
            &screens,
        )
        .unwrap();
        assert_eq!((back.x, back.y), (100, 640));
    }

    #[test]
    fn fit_survives_tiny_monitors_without_panicking() {
        let back = fit_rect(
            WinRect {
                x: 50,
                y: 50,
                w: 1180,
                h: 760,
            },
            &[plain(0, 0, 100, 100)],
        )
        .unwrap();
        assert_eq!((back.w, back.h), (100, 100));
        assert_eq!((back.x, back.y), (0, 0));
    }

    #[test]
    fn fit_refuses_a_rect_it_could_never_show() {
        // a minimized window's iconic rect: nothing to restore, so the
        // caller centers the config default instead of opening a
        // minimum-size window in the corner
        assert_eq!(
            fit_rect(
                WinRect {
                    x: -32000,
                    y: -32000,
                    w: 199,
                    h: 34
                },
                &one_mon()
            ),
            None
        );
        assert_eq!(
            fit_rect(
                WinRect {
                    x: 100,
                    y: 100,
                    w: 480,
                    h: 760
                },
                &one_mon()
            ),
            None
        );
    }

    #[test]
    fn storable_rect_drops_the_geometry_of_a_minimized_window() {
        let live = WinRect {
            x: 100,
            y: 100,
            w: 1180,
            h: 760,
        };
        assert_eq!(storable_rect(false, live), Some(live));
        // what Windows reports while minimized: the iconic rect, which
        // must never become the remembered geometry
        assert_eq!(
            storable_rect(
                true,
                WinRect {
                    x: -32000,
                    y: -32000,
                    w: 199,
                    h: 34
                }
            ),
            None
        );
    }

    #[test]
    fn resave_skips_a_rect_that_already_fits() {
        let r = WinRect {
            x: 100,
            y: 100,
            w: 1180,
            h: 760,
        };
        assert_eq!(resave_after_fit(Some(r), r), None);
    }

    #[test]
    fn resave_replaces_a_rect_the_fit_moved() {
        let saved = WinRect {
            x: 100,
            y: 400,
            w: 1180,
            h: 760,
        };
        let fitted = fit_rect(saved, &one_mon()).unwrap();
        assert_eq!(resave_after_fit(Some(saved), fitted), Some(fitted));
        // a launch with nothing stored still persists what it applied
        assert_eq!(resave_after_fit(None, fitted), Some(fitted));
    }

    #[test]
    fn next_stored_keeps_rect_while_maximized() {
        let old = StoredGeom {
            rect: Some(WinRect {
                x: 10,
                y: 10,
                w: 800,
                h: 600,
            }),
            maximized: false,
        };
        let live = WinRect {
            x: 0,
            y: 0,
            w: 1920,
            h: 1040,
        };
        assert_eq!(
            next_stored(old, true, live),
            StoredGeom {
                rect: old.rect,
                maximized: true
            }
        );
    }

    #[test]
    fn next_stored_records_live_rect_when_normal() {
        let old = StoredGeom {
            rect: Some(WinRect {
                x: 10,
                y: 10,
                w: 800,
                h: 600,
            }),
            maximized: true,
        };
        let live = WinRect {
            x: 20,
            y: 20,
            w: 900,
            h: 700,
        };
        assert_eq!(
            next_stored(old, false, live),
            StoredGeom {
                rect: Some(live),
                maximized: false
            }
        );
    }
}
