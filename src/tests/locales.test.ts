// locales.test.ts — the locale type bond, as a test.
// The `ar: Locale` typing already makes key drift a BUILD error; this test
// catches it even in editor-less contexts (and keeps the two files honest
// about nested structure, not just top-level keys).

import { describe, expect, it } from "vitest";
import { ar } from "../locales/ar";
import { en } from "../locales/en";

function flatKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      keys.push(...flatKeys(v as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

describe("locale parity", () => {
  it("ar carries exactly the same keys as en", () => {
    expect(flatKeys(ar as unknown as Record<string, unknown>)).toEqual(
      flatKeys(en as unknown as Record<string, unknown>),
    );
  });

  it("both declare a direction and a language code", () => {
    expect(["ltr", "rtl"]).toContain(en.lang.dir);
    expect(["ltr", "rtl"]).toContain(ar.lang.dir);
    expect(ar.lang.code).toBe("ar");
  });
});
