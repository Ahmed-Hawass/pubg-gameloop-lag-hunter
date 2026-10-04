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

/** committed page file sizes for the "Currently using" strip line: the
    sum of custom initials (the reservation Windows holds now) plus the
    live drive count. Null = no line: automatic mode (sizes are
    Windows-owned, any sum would be invented) or nothing live at all.
    Unreadable ("unknown") drives are never claimed. */
export function summarizePagefileUsage(s: PagefileSettings | null): {
  sumMb: number;
  live: number;
  allSystem: boolean;
} | null {
  if (!s || s.automatic) return null;
  const live = s.drives.filter((d) => d.mode === "system" || d.mode === "custom");
  if (live.length === 0) return null;
  return {
    sumMb: live.reduce((sum, d) => sum + (d.mode === "custom" ? (d.min_mb ?? 0) : 0), 0),
    live: live.length,
    allSystem: live.every((d) => d.mode === "system"),
  };
}

/** sweep-memory formatting, shared by the landing card and the sweep
    page: one-decimal MB (measured, never estimated) and the stored ISO
    stamp as a locale-free date plus the OS-convention time. The same
    shapes the storage summary used before the card split. */
export function cleanupMb(bytes: number): number {
  return Math.round((bytes / 1048576) * 10) / 10;
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
