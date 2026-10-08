// tests/pagefileSync.test.ts — the editor's working-copy sync rule:
// the selection survives when the drive is still there, the mode falls
// back to custom on an unreadable drive, sizes prefill from live.

import { describe, expect, it } from "vitest";
import { syncPagefileWorkingCopies } from "../views/tools/pagefileSync";
import { pagefileSettings } from "./fixtures";

describe("syncPagefileWorkingCopies", () => {
  it("keeps the selected drive with its live mode and sizes", () => {
    const pf = pagefileSettings({
      automatic: false,
      drives: [
        { drive: "C:", free_mb: 50000, mode: "system", min_mb: null, max_mb: null },
        { drive: "D:", free_mb: 90000, mode: "custom", min_mb: 1024, max_mb: 4096 },
      ],
    });
    expect(syncPagefileWorkingCopies(pf, "D:")).toEqual({
      drive: "D:",
      mode: "custom",
      minInput: "1024",
      maxInput: "4096",
    });
  });

  it("falls back to the first drive when the selection is gone", () => {
    const pf = pagefileSettings({
      automatic: false,
      drives: [{ drive: "C:", free_mb: 50000, mode: "system", min_mb: null, max_mb: null }],
    });
    expect(syncPagefileWorkingCopies(pf, "D:").drive).toBe("C:");
  });

  it("forces custom with empty sizes on an unreadable drive", () => {
    const pf = pagefileSettings({
      automatic: false,
      drives: [{ drive: "C:", free_mb: null, mode: "unknown", min_mb: null, max_mb: null }],
    });
    expect(syncPagefileWorkingCopies(pf, "C:")).toEqual({
      drive: "C:",
      mode: "custom",
      minInput: "",
      maxInput: "",
    });
  });
});
