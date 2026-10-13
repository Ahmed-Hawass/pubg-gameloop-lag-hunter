// tests/toolsSummary.test.ts — shared Tools math: the sweep-memory
// line shapes (last run plus last-30-days, or never).

import { describe, expect, it } from "vitest";
import { en } from "../locales/en";
import {
  cleanupHistoryLine,
  cleanupMb,
  cleanupWhen,
  defaultCheckedIds,
  formatSweepBytes,
} from "../views/tools/summary";

describe("sweep memory formatting", () => {
  it("renders one-decimal MB and the short stamp", () => {
    expect(cleanupMb(10485760)).toBe(10);
    expect(cleanupWhen("2026-09-20T14:30:00", false, "en")).toBe("2026-09-20 14:30");
  });

  it("lines the last run with the 30-day total, or the never line", () => {
    const h = {
      last_freed_bytes: 10485760,
      last_at: "2026-09-20T14:30:00",
      last_30d_bytes: 20971520,
    };
    expect(cleanupHistoryLine(en, h, false, "en")).toBe(
      `${en.cleanupLast(10, "2026-09-20 14:30")} · ${en.cleanup30d(20)}`,
    );
    // a 12-hour machine reads its own convention, same shapes
    expect(cleanupHistoryLine(en, h, true, "en")).toBe(
      `${en.cleanupLast(10, "2026-09-20 2:30 PM")} · ${en.cleanup30d(20)}`,
    );
    expect(cleanupHistoryLine(en, h, true, "ar")).toContain("2:30 م");
    expect(
      cleanupHistoryLine(en, { last_freed_bytes: 0, last_at: null, last_30d_bytes: 0 }, false, "en"),
    ).toBe(en.cleanupLastNever);
  });
});

describe("sweep place display", () => {
  it("reads GB above 1 GB, MB below, dashes when unreadable", () => {
    expect(formatSweepBytes(null)).toBe("--");
    expect(formatSweepBytes(0)).toBe("0.0 MB");
    expect(formatSweepBytes(10485760)).toBe("10.0 MB");
    expect(formatSweepBytes(2147483648)).toBe("2.0 GB");
  });

  it("marks partial sums with ~ and leaves exact numbers bare", () => {
    expect(formatSweepBytes(10485760, true)).toBe("~10.0 MB");
    expect(formatSweepBytes(2147483648, true)).toBe("~2.0 GB");
    expect(formatSweepBytes(10485760, false)).toBe("10.0 MB");
    // unknown stays unknown: no "~" on a "--"
    expect(formatSweepBytes(null, true)).toBe("--");
  });

  it("ticks every non-empty place by default, never zero or unknown", () => {
    expect(
      defaultCheckedIds([
        { id: "user_temp", bytes: 10485760 },
        { id: "system_temp", bytes: 0 },
        { id: "recycle_bin", bytes: null },
      ]),
    ).toEqual(["user_temp"]);
    expect(defaultCheckedIds([])).toEqual([]);
  });
});
