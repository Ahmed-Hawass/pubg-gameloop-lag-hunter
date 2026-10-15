// tests/clock.test.ts — wall-clock display for the OS convention: stable
// machine shapes convert ("14:30" to "2:30 PM" on 12-hour), 24-hour mode
// keeps today's pixels exactly, and anything unparseable comes back
// verbatim (a clock line never goes blank, never throws).

import { describe, expect, it } from "vitest";
import { formatClockTime } from "../clock";

describe("formatClockTime", () => {
  it("converts HH:MM under the 12-hour convention", () => {
    expect(formatClockTime("14:30", true, "en")).toBe("2:30 PM");
    expect(formatClockTime("00:05", true, "en")).toBe("12:05 AM");
    expect(formatClockTime("12:00", true, "en")).toBe("12:00 PM");
    expect(formatClockTime("11:30", true, "en")).toBe("11:30 AM");
  });

  it("keeps 24-hour pixels identical to the stored string", () => {
    expect(formatClockTime("14:30", false, "en")).toBe("14:30");
    expect(formatClockTime("00:05", false, "en")).toBe("00:05");
    expect(formatClockTime("14:30:05", false, "en")).toBe("14:30:05");
  });

  it("keeps seconds in both modes", () => {
    expect(formatClockTime("14:30:05", true, "en")).toBe("2:30:05 PM");
    expect(formatClockTime("09:00:00", true, "en")).toBe("9:00:00 AM");
  });

  it("marks the day period in the app language with Latin digits", () => {
    expect(formatClockTime("14:30", true, "ar")).toBe("2:30 م");
    expect(formatClockTime("09:15", true, "ar")).toBe("9:15 ص");
    // 24-hour Arabic stays Latin too (never Eastern Arabic digits)
    expect(formatClockTime("14:30", false, "ar")).toBe("14:30");
  });

  it("returns garbage verbatim instead of blanking or throwing", () => {
    for (const bad of ["", "nope", "25:00", "14:61", "14", "14:30:05:01", "ab:cd"]) {
      expect(formatClockTime(bad, true, "en")).toBe(bad);
      expect(formatClockTime(bad, false, "ar")).toBe(bad);
    }
  });
});
