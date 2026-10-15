// summary.ts — shared Tools math with the exact rules the details pages
// render, plus the shared sweep-memory formatting. One function per
// consumer group: faces can never drift from the pages behind them.

import type { CleanupHistory, PagefileSettings, RowState, TweakStates } from "../../bridge";
import type { Locale } from "../../locales/en";
import type { LangCode } from "../../i18n";
import { formatClockTime } from "../../clock";

/** every Hidden* shape plus legacy "hidden": never rendered, never
    counted by default — the show-unsupported preference names each
    cause instead. Lives here (not bridge: test mocks replace the
    bridge module wholesale, and a runtime import from it would crash
    every suite — types alone are erased and safe). */
export function isHiddenRowState(s: RowState): boolean {
  return s === "hidden" || s === "hidden_old_build" || s === "hidden_s0" || s === "hidden_ultimate";
}

export function summarizeTweaks(s: TweakStates): { shown: number; on: number } {
  const rows: { shown: boolean; on: boolean }[] = [
    { shown: !isHiddenRowState(s.power_high_perf), on: s.power_high_perf === "on" },
    { shown: !isHiddenRowState(s.memory_integrity), on: s.memory_integrity === "on" },
    { shown: true, on: !s.game_dvr_enabled },
    { shown: true, on: s.game_mode },
    { shown: !isHiddenRowState(s.fso_disabled), on: s.fso_disabled === "on" },
    { shown: s.windowed_game_opt !== null, on: s.windowed_game_opt === true },
    { shown: !isHiddenRowState(s.gpu_high_perf), on: s.gpu_high_perf === "on" },
    { shown: true, on: s.mouse_accel_off },
  ];
  const shown = rows.filter((r) => r.shown);
  return { shown: shown.length, on: shown.filter((r) => r.on).length };
}

/** page file health: the exact rule the editor paints (automatic, or a
    single viable file: system-managed, or custom at or above the 8 GB
    stutter floor). Shared by the editor and the landing badge. */
export function summarizePagefile(s: PagefileSettings | null): boolean | null {
  if (!s) return null;
  return (
    s.automatic ||
    s.drives.some(
      (d) =>
        d.mode === "system" ||
        (d.mode === "custom" && (d.max_mb ?? 0) >= 8192),
    )
  );
}

/** sweep-memory formatting, shared by the landing card and the sweep
    page: one-decimal MB (measured, never estimated) and the stored ISO
    stamp as a locale-free date plus the OS-convention time. The same
    shapes the storage summary used before the card split. */
/** bytes in one MiB: the single divisor for MB display (see BYTES_PER_GB) */
export const BYTES_PER_MB = 1048576;
export function cleanupMb(bytes: number): number {
  return Math.round((bytes / BYTES_PER_MB) * 10) / 10;
}

/** measured-bytes display for one sweep place: GB above 1 GB, MB
    below, "--" when unreadable (never a guess), "~" prefix when partial
    (some entries refused, so the number counts only what was readable).
    Latin units either way, like every other measurement. Extracted from
    the sweep section so faces share the shape. */
/** bytes in one GiB: the single threshold/divisor for GB display */
export const BYTES_PER_GB = 1073741824;
export function formatSweepBytes(bytes: number | null, partial = false): string {
  if (bytes == null) return "--";
  const body =
    bytes >= BYTES_PER_GB ? `${(bytes / BYTES_PER_GB).toFixed(1)} GB` : `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
  return partial ? `~${body}` : body;
}

/** default tick set after a quick scan: every non-empty place ticked
    (the user unticks, never us); zero/unknown rows render muted with
    a disabled checkbox. Extracted pure so the rule is pinned by test. */
export function defaultCheckedIds(categories: { id: string; bytes: number | null }[]): string[] {
  return categories.filter((c) => (c.bytes ?? 0) > 0).map((c) => c.id);
}

/** "YYYY-MM-DD" plus the wall time under the OS convention
    ("2026-09-20 2:30 PM" on a 12-hour machine). Null convention means
    the flag has not landed yet: raw 24-hour, the stored truth itself,
    never a guess. */
export function cleanupWhen(iso: string, hour12: boolean | null, lang: LangCode): string {
  return `${iso.slice(0, 10)} ${formatClockTime(iso.slice(11, 16), hour12 ?? false, lang)}`;
}

/** one history line for a details surface (last run plus last-30-days),
    or the never-cleaned line when the memory holds no run yet. The
    landing card renders the last-run half inline from the same
    helpers, so the two faces share every shape. */
export function cleanupHistoryLine(
  t: Pick<Locale, "cleanupLastNever" | "cleanupLast" | "cleanup30d">,
  h: CleanupHistory,
  hour12: boolean | null,
  lang: LangCode,
): string {
  if (!h.last_at) return t.cleanupLastNever;
  return `${t.cleanupLast(cleanupMb(h.last_freed_bytes), cleanupWhen(h.last_at, hour12, lang))} · ${t.cleanup30d(cleanupMb(h.last_30d_bytes))}`;
}
