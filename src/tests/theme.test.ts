// theme.test.ts — appearance resolution, as tests.
// The bug class this guards: an unknown stored value (hand-edited settings,
// older file) producing no theme — or "auto" ignoring the OS.

import { describe, expect, it } from "vitest";
import { resolveTheme } from "../theme";

describe("resolveTheme", () => {
  it("explicit dark/light win regardless of the OS", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
  });

  it("auto follows the OS preference", () => {
    expect(resolveTheme("auto", true)).toBe("light");
    expect(resolveTheme("auto", false)).toBe("dark");
  });

  it("unknown values fall back to the OS, never to nothing", () => {
    expect(resolveTheme("", true)).toBe("light");
    expect(resolveTheme("", false)).toBe("dark");
    expect(resolveTheme("blue", false)).toBe("dark");
  });
});
