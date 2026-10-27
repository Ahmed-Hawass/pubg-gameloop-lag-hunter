// locales.test.ts - the locale type bond, as a test.
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
    // items against en's 5 passed the key test untouched - arrays are
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

  it("curated process names are present and non-empty in both locales", () => {
    // flatKeys pins the key SETS; this pins the VALUES: a dropped
    // translation must not hide behind an empty-string placeholder
    for (const [key, value] of Object.entries(en.procNames)) {
      expect(String(value).trim().length).toBeGreaterThan(0);
      expect(String(ar.procNames[key] ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("no Arabic string is empty", () => {
    // a dropped translation renders as a blank label at runtime; the key
    // parity test cannot see it (the key is there, the text is not)
    const walk = (obj: Record<string, unknown>, path = ""): void => {
      for (const [k, v] of Object.entries(obj)) {
        const p = path ? `${path}.${k}` : k;
        if (typeof v === "string") {
          expect(v.trim().length, `${p} is empty in the Arabic locale`).toBeGreaterThan(0);
        } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          walk(v as Record<string, unknown>, p);
        }
      }
    };
    walk(ar as unknown as Record<string, unknown>);
  });
});

describe("Arabic counted nouns", () => {
  it("the session plan shows the unit, never the number twice", () => {
    // the big "5" is rendered beside the unit: a unit that carried the
    // number too showed "5 5 دقائق" in the idle screen
    expect(ar.scanPlanUnit(5)).toBe("دقائق للجلسة");
    expect(ar.scanPlanUnit(5)).not.toContain("5");
    expect(ar.scanPlanUnit(30)).toBe("دقيقة للجلسة");
    expect(ar.scanPlanUnit(60)).toBe("دقيقة للجلسة");
  });

  it("11 and up take the singular, 3-10 take the plural", () => {
    // Arabic: 11 takes the singular ("11 إعداد"), 3-10 the plural
    expect(ar.healthNeedsTitle(3)).toContain("إعدادات");
    expect(ar.healthNeedsTitle(11)).toContain("11 إعداد");
    expect(ar.healthNeedsTitle(11)).not.toContain("إعدادات");
    expect(ar.tweakBannerNeeds(11)).toContain("11 خيار");
    expect(ar.tweakBannerNeeds(11)).not.toContain("خيارات");
  });

  it("the verb agrees with the noun's form", () => {
    expect(ar.healthNeedsTitle(1)).toBe("إعداد واحد يحتاج إلى انتباه");
    expect(ar.healthNeedsTitle(2)).toBe("إعدادان يحتاجان إلى انتباه");
    expect(ar.healthNeedsTitle(3)).toBe("3 إعدادات تحتاج إلى انتباه");
    expect(ar.healthNeedsTitle(11)).toBe("11 إعداد يحتاج إلى انتباه");
    expect(ar.tweakBannerNeeds(1)).toBe("خيار واحد يحتاج إلى ضبط");
    expect(ar.tweakBannerNeeds(2)).toBe("خياران يحتاجان إلى ضبط");
    expect(ar.tweakBannerNeeds(3)).toBe("3 خيارات تحتاج إلى ضبط");
  });

  it("the remaining time reads naturally", () => {
    expect(ar.scanRemaining(1)).toBe("دقيقة واحدة متبقية");
    expect(ar.scanRemaining(2)).toBe("دقيقتان متبقيتان");
    expect(ar.scanRemaining(5)).toBe("5 دقائق متبقية");
    expect(ar.scanRemaining(30)).toBe("30 دقيقة متبقية");
  });
});
