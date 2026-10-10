// pagefileSync.ts — the working-copy sync rule for the Virtual Memory
// editor: which drive stays selected and what mode/sizes prefill from
// the fresh read. Extracted pure from the editor so the rule is pinned
// by unit test: the selection survives when the drive is still there,
// the mode falls back to custom on an unreadable drive (forces an
// explicit choice, validation guides from there).

import type { PagefileSettings } from "../../bridge";

export type PagefileModeChoice = "system" | "custom" | "off";

export function syncPagefileWorkingCopies(
  pf: PagefileSettings,
  currentDrive: string,
): { drive: string; mode: PagefileModeChoice; minInput: string; maxInput: string } {
  const drive = pf.drives.some((d) => d.drive === currentDrive)
    ? currentDrive
    : (pf.drives[0]?.drive ?? "");
  const live = pf.drives.find((d) => d.drive === drive);
  return {
    drive,
    mode: live && live.mode !== "unknown" ? live.mode : "custom",
    minInput: live?.min_mb?.toString() ?? "",
    maxInput: live?.max_mb?.toString() ?? "",
  };
}
