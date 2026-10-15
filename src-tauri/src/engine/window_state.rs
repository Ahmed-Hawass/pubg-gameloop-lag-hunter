// window_state.rs — remembered main-window geometry: pure rules only.
//
// The window opens at the config default (tauri.conf.json) unless the user
// customized it before: outer size, position and the maximized flag persist
// in settings.json and are reapplied before first show. All Tauri calls
// (monitors, live rect) stay in lib.rs; everything decidable from numbers
// lives here and is unit-tested.

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

/// floor mirrors the window minimums in tauri.conf.json (minWidth /
/// minHeight): a restored window never opens smaller than the UI supports.
pub const MIN_W: u32 = 500;
pub const MIN_H: u32 = 400;
/// absurd saved dims (hand-edited file, corrupt JSON): larger than any
/// real display — treated as "no geometry", never applied.
const MAX_DIM: u32 = 7680;
/// a restored rect must keep at least this many pixels on a monitor to
/// count as visible: a 1px sliver is a lost window with extra steps.
const VISIBLE_PX: i64 = 120;

/// Reject garbage before it ever reaches a monitor: zero dims, or dims no
/// display on earth has. Pure.
pub fn sane_rect(r: WinRect) -> bool {
    r.w > 0 && r.h > 0 && r.w <= MAX_DIM && r.h <= MAX_DIM
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

/// Fit a saved rect onto the current monitors: pick the monitor holding
/// most of it, shrink oversized dims to fit, then pull the position until
/// VISIBLE_PX stay on screen. None = nothing usable (no monitors, or an
/// insane rect): the caller centers the config default instead. Pure.
pub fn fit_rect(saved: WinRect, mons: &[(i32, i32, u32, u32)]) -> Option<WinRect> {
    if !sane_rect(saved) || mons.is_empty() {
        return None;
    }
    let mut best = 0usize;
    let mut best_area: i64 = -1;
    for (i, m) in mons.iter().enumerate() {
        let area = overlap_area(saved, *m);
        if area > best_area {
            best_area = area;
            best = i;
        }
    }
    let (mx, my, mw, mh) = mons[best];
    let w = saved.w.min(mw).max(MIN_W.min(mw));
    let h = saved.h.min(mh).max(MIN_H.min(mh));
    let x = clamp_on_axis(saved.x as i64, w as i64, mx as i64, mw as i64);
    let y = clamp_on_axis(saved.y as i64, h as i64, my as i64, mh as i64);
    Some(WinRect { x, y, w, h })
}

fn overlap_area(r: WinRect, m: (i32, i32, u32, u32)) -> i64 {
    let (mx, my, mw, mh) = m;
    let x1 = (r.x as i64).max(mx as i64);
    let y1 = (r.y as i64).max(my as i64);
    let x2 = (r.x as i64 + r.w as i64).min(mx as i64 + mw as i64);
    let y2 = (r.y as i64 + r.h as i64).min(my as i64 + mh as i64);
    (x2 - x1).max(0) * (y2 - y1).max(0)
}

/// Keep [pos, pos+len] on [mon, mon+mon_len] with at least VISIBLE_PX
/// visible; if the rect cannot fit visibly at all (a monitor narrower
/// than the sliver), pin to the monitor origin instead of panicking.
fn clamp_on_axis(pos: i64, len: i64, mon: i64, mon_len: i64) -> i32 {
    let lo = mon - len + VISIBLE_PX;
    let hi = mon + mon_len - VISIBLE_PX;
    if lo > hi {
        return mon as i32;
    }
    pos.clamp(lo, hi) as i32
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

    fn one_mon() -> Vec<(i32, i32, u32, u32)> {
        vec![(0, 0, 1920, 1080)]
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
    fn fit_shrinks_oversized_rects() {
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
        assert_eq!((back.w, back.h), (1920, 1080));
        assert_eq!((back.x, back.y), (0, 0));
    }

    #[test]
    fn fit_pulls_offscreen_rects_back() {
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
        // keeps the 120px sliver visible: -1060 + 1180 = 120
        assert_eq!((back.x, back.y), (-1060, 100));
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
        assert_eq!((back.x, back.y), (1800, 960));
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
        let mons = vec![(0, 0, 1920, 1080), (1920, 0, 1920, 1080)];
        let back = fit_rect(
            WinRect {
                x: 2000,
                y: 100,
                w: 1180,
                h: 760,
            },
            &mons,
        )
        .unwrap();
        assert_eq!((back.x, back.y), (2000, 100));
        // mostly off every screen: lands on the best overlap, sliver kept
        let back = fit_rect(
            WinRect {
                x: -1500,
                y: -900,
                w: 500,
                h: 400,
            },
            &mons,
        )
        .unwrap();
        assert_eq!((back.x, back.y), (-380, -280));
    }

    #[test]
    fn fit_survives_tiny_monitors_without_panicking() {
        let mons = vec![(0, 0, 100, 100)];
        let back = fit_rect(
            WinRect {
                x: 50,
                y: 50,
                w: 1180,
                h: 760,
            },
            &mons,
        )
        .unwrap();
        assert_eq!((back.w, back.h), (100, 100));
        assert_eq!((back.x, back.y), (0, 0));
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
