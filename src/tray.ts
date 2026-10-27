// tray.ts - the tray's two decisions, as pure logic.
//
// The native surface is Rust's (tray.rs); the COPY is the locale files'. What
// is left here is exactly what the frontend owns: WHEN the tooltip changes,
// and whether "Quick scan" starts a scan or only shows the window. Both are
// pinned by src/tests/tray.test.ts.

import type { StatusPayload } from "./bridge";

/** How often the tray tooltip may change while a scan runs. The tooltip is
    the ONLY signal a user with a hidden window gets that something is
    happening, so it must move; it does not need to move per second (an IPC
    push per state tick is a flood), and 5% steps read fine. */
export const TOOLTIP_STEP_PCT = 5;

/** The percent to push to the tray tooltip, or null when nothing moved
    enough to be worth an IPC round-trip.

    0 means "not scanning" (idle/finished), which is also how the tooltip
    returns to its normal wording the moment a scan ends. `lastSent` is the
    previous value (null = nothing pushed yet), kept by the caller because
    this function must stay pure. */
export function trayPercentToPush(
  status: StatusPayload,
  lastSent: number | null,
): number | null {
  if (status.status !== "running" || !status.ui) return 0;
  const { elapsed_sec: elapsed, auto_stop_sec: auto } = status.ui;
  if (!auto || auto <= 0) return 0;
  const pct = Math.min(100, Math.max(0, Math.round((elapsed / auto) * 100)));
  // 100 always goes through: it is the last one the user sees, and a
  // finished-at-99% scan must not sit there looking unfinished.
  if (pct === 100) return pct;
  if (lastSent !== null && pct > 0 && Math.abs(pct - lastSent) < TOOLTIP_STEP_PCT) return null;
  return pct;
}

/** What the tray's scan item should do. "start" whenever the monitor is
    not mid-scan: an explicit press means a new scan, even over an unread
    verdict (its report stays saved in Reports, and the new run replaces
    the card). "stop" while a scan is running (the item reads Stop then);
    "show" only while a scan is winding down, since starting over it would
    be refused by the engine gate. */
export type QuickScanIntent = "start" | "stop" | "show";

/** A result the user can still read: the verdict card shows until it is
    dismissed or the session is deleted. Same condition as MonitorView's
    resultAllowed, kept here so the tray asks the same question the page
    answers. Exported for the tooltip too: a finished-but-unread scan gets
    its own wording instead of falling back to idle. */
export function hasLiveResult(status: StatusPayload, dismissedSession: string | null): boolean {
  const ui = status.ui;
  return (
    status.status === "finished" &&
    ui != null &&
    ui.samples_count > 0 &&
    ui.session != null &&
    ui.session !== dismissedSession
  );
}

export function quickScanIntent(status: StatusPayload): QuickScanIntent {
  if (status.status === "running") return "stop";
  if (status.status === "stopping") return "show";
  return "start";
}

/** Scan completion percent for the tray scan item label, from the same
    live counters as the tooltip (elapsed over auto-stop, clamped 0 to 100).
    Null while no scan is measuring, so the item reads plain words then.
    Same source as the tooltip on purpose: two surfaces, one number. */
export function scanPercent(status: StatusPayload): number | null {
  if (status.status !== "running" && status.status !== "stopping") return null;
  const ui = status.ui;
  if (!ui) return null;
  const { elapsed_sec: elapsed, auto_stop_sec: auto } = ui;
  if (!auto || auto <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((elapsed / auto) * 100)));
}