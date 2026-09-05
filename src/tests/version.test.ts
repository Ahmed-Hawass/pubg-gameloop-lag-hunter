// version.test.ts — the comparison the update check depends on.
// The old text compare had two real failure modes: "1.10.0" < "1.2.0" as
// strings, and ANY different (even older) tag read as "update available".

import { describe, expect, it } from "vitest";
import { compareVersions, isNewerRelease } from "../version";

describe("compareVersions", () => {
  it("orders numeric components correctly", () => {
    expect(compareVersions("1.10.0", "1.2.0")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
  });

  it("equal versions compare equal", () => {
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
  });

  it("major beats minor", () => {
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.9.9", "1.0.0")).toBeLessThan(0);
  });

  it("missing parts count as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.3", "1.2.9")).toBeGreaterThan(0);
  });

  it("non-numeric parts compare as zero, never claim phantom updates", () => {
    expect(compareVersions("1.2.x", "1.2.0")).toBe(0);
    expect(compareVersions("", "1.2.0")).toBeLessThan(0);
  });
});

describe("isNewerRelease", () => {
  it("true only when strictly newer", () => {
    expect(isNewerRelease("1.3.0", "1.2.0")).toBe(true);
    expect(isNewerRelease("1.2.0", "1.2.0")).toBe(false);
    // the old bug: an OLDER published tag read as an update
    expect(isNewerRelease("1.0.0", "1.2.0")).toBe(false);
  });

  it("never fires on empty input", () => {
    expect(isNewerRelease("", "1.2.0")).toBe(false);
    expect(isNewerRelease("1.3.0", "")).toBe(false);
    expect(isNewerRelease("", "")).toBe(false);
  });
});
