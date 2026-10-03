// summary.ts — shared Tools math with the exact rules the details pages
// render, plus the shared sweep-memory formatting. One function per
// consumer group: faces can never drift from the pages behind them.

import type { CleanupHistory, PagefileSettings, TweakStates } from "../../bridge";
import type { Locale } from "../../locales/en";

export function summarizeTweaks(s: TweakStates): { shown: number; on: number } {
  const rows: { shown: boolean; on: boolean }[] = [
    { shown: s.power_high_perf !== "hidden", on: s.power_high_perf === "on" },
    { shown: true, on: !s.game_dvr_enabled },
    { shown: true, on: s.game_mode },
    { shown: s.fso_disabled !== "hidden", on: s.fso_disabled === "on" },
    { shown: s.windowed_game_opt !== null, on: s.windowed_game_opt === true },
    { shown: s.gpu_high_perf !== "hidden", on: s.gpu_high_perf === "on" },
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
    page: one-decimal MB (measured, never estimated) and the "YYYY-MM-DD
    HH:MM" slice of the stored ISO stamp. The same shapes the storage
    summary used before the card split. */
export function cleanupMb(bytes: number): number {
  return Math.round((bytes / 1048576) * 10) / 10;
}

export function cleanupWhen(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** one history line for a details surface (last run plus last-30-days),
    or the never-cleaned line when the memory holds no run yet. The
    landing card renders the last-run half inline from the same
    helpers, so the two faces share every shape. */
export function cleanupHistoryLine(
  t: Pick<Locale, "cleanupLastNever" | "cleanupLast" | "cleanup30d">,
  h: CleanupHistory,
): string {
  if (!h.last_at) return t.cleanupLastNever;
  return `${t.cleanupLast(cleanupMb(h.last_freed_bytes), cleanupWhen(h.last_at))} · ${t.cleanup30d(cleanupMb(h.last_30d_bytes))}`;
}
