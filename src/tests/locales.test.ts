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

/** Arrays are leaves for flatKeys, so their CONTENT parity needs its own
 *  walk: an ar list that silently shipped 4 items against en's 5 (or
 *  different items in the same order) passed the key test untouched. */
function arrayPaths(
  obj: Record<string, unknown>,
  prefix = "",
): [string, unknown[]][] {
  const out: [string, unknown[]][] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) {
      out.push([path, v]);
    } else if (typeof v === "object" && v !== null) {
      out.push(...arrayPaths(v as Record<string, unknown>, path));
    }
  }
  return out.sort(([a], [b]) => a.localeCompare(b));
}

describe("locale parity", () => {
  it("ar carries exactly the same keys as en", () => {
    expect(flatKeys(ar as unknown as Record<string, unknown>)).toEqual(
      flatKeys(en as unknown as Record<string, unknown>),
    );
  });

  it("ar's arrays match en's arrays path-for-path and length-for-length", () => {
    // content itself is TRANSLATED, so only the shape can be pinned: same
    // array paths, same item counts (an ar list that silently shipped 4
    // items against en's 5 passed the key test untouched — arrays are
    // leaves there). Per-item emptiness is checked too: a dropped
    // translation must not hide behind an empty-string placeholder.
    const enArrays = arrayPaths(en as unknown as Record<string, unknown>);
    const arArrays = arrayPaths(ar as unknown as Record<string, unknown>);
    expect(arArrays.map(([p]) => p)).toEqual(enArrays.map(([p]) => p));
    for (let i = 0; i < enArrays.length; i++) {
      expect(arArrays[i][1]).toHaveLength(enArrays[i][1].length);
      for (const item of arArrays[i][1]) {
        expect(String(item).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("both declare a direction and a language code", () => {
    expect(["ltr", "rtl"]).toContain(en.lang.dir);
    expect(["ltr", "rtl"]).toContain(ar.lang.dir);
    expect(ar.lang.code).toBe("ar");
  });
});
