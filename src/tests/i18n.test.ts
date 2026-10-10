// tests/i18n.test.ts — the OS locale mapping is pure logic: every
// Windows Arabic variant resolves to Arabic, everything else to English.

import { describe, expect, it, vi } from "vitest";
import { osLanguage } from "../i18n";

function setLanguages(langs: string[]) {
  vi.spyOn(window.navigator, "languages", "get").mockReturnValue(
    langs as readonly string[],
  );
}

describe("osLanguage", () => {
  it("maps Arabic variants to ar", () => {
    for (const langs of [["ar"], ["ar-EG"], ["AR-sa"], ["ar", "en-US"]]) {
      setLanguages(langs);
      expect(osLanguage()).toBe("ar");
    }
    vi.restoreAllMocks();
  });

  it("falls back to en for anything else", () => {
    for (const langs of [["en-US"], ["en", "fr"], ["de-DE"], []]) {
      setLanguages(langs);
      expect(osLanguage()).toBe("en");
    }
    vi.restoreAllMocks();
  });
});
