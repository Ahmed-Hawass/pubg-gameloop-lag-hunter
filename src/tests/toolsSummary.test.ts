// tests/toolsSummary.test.ts — shared Tools math: the "Currently using"
// rule (manual custom initials plus the live count, never a guess) and
// the sweep-memory line shapes (last run plus last-30-days, or never).

import { describe, expect, it } from "vitest";
import { en } from "../locales/en";
import {
  cleanupHistoryLine,
  cleanupMb,
  cleanupWhen,
  defaultCheckedIds,
  formatSweepBytes,
  summarizePagefileUsage,
} from "../views/tools/summary";
import { pagefileSettings } from "./fixtures";

describe("summarizePagefileUsage", () => {
  it("stays silent on automatic, empty, and unreadable setups", () => {
    expect(summarizePagefileUsage(null)).toBeNull();
    expect(summarizePagefileUsage(pagefileSettings({ automatic: true }))).toBeNull();
    expect(
      summarizePagefileUsage(
        pagefileSettings({
          automatic: false,
          drives: [{ drive: "C:", free_mb: 1, mode: "off", min_mb: null, max_mb: null }],
        }),
      ),
    ).toBeNull();
    // unknown is unreadable: never claimed as live
    expect(
      summarizePagefileUsage(
        pagefileSettings({
          automatic: false,
          drives: [{ drive: "C:", free_mb: null, mode: "unknown", min_mb: null, max_mb: null }],
        }),
      ),
    ).toBeNull();
  });

  it("sums custom initials and counts every live drive", () => {
    expect(
      summarizePagefileUsage(
        pagefileSettings({
          automatic: false,
          drives: [
            { drive: "C:", free_mb: 50000, mode: "custom", min_mb: 16384, max_mb: 49152 },
            { drive: "D:", free_mb: 90000, mode: "system", min_mb: null, max_mb: null },
          ],
        }),
      ),
    ).toEqual({ sumMb: 16384, live: 2, allSystem: false });
  });

  it("names the all-system setup instead of summing zeros", () => {
    expect(summarizePagefileUsage(pagefileSettings())).toEqual({
      sumMb: 0,
      live: 1,
      allSystem: true,
    });
  });
});

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
      "Last clean: 10 MB on 2026-09-20 14:30. · Last 30 days: 20 MB.",
    );
    // a 12-hour machine reads its own convention, same shapes
    expect(cleanupHistoryLine(en, h, true, "en")).toBe(
      "Last clean: 10 MB on 2026-09-20 2:30 PM. · Last 30 days: 20 MB.",
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
