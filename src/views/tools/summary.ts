// summary.ts — landing badge math over the seven gaming rows, with the
// exact shown/off rules the details page renders (hidden rows do not
// exist, disabled rows wait on GameLoop). One function, two consumers
// (the landing badge and the details banner): the rules can never drift
// between the card face and the page behind it.

import type { TweakStates } from "../../bridge";

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
