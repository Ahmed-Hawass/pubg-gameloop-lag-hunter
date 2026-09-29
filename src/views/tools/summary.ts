// summary.ts — landing badge math with the exact rules the details
// pages render. One function per card, shared consumers: the rules can
// never drift between the card face and the page behind it.

import type { PagefileSettings, TweakStates } from "../../bridge";

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
