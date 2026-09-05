// i18n.tsx — the language layer. Zero dependencies: two locale files + context.
// Resolution order: user toggle (persisted) > OS locale (at launch) > English.
// "auto" re-resolves from the OS on every launch — a fresh machine starts right.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { en, type Locale } from "./locales/en";
import { ar } from "./locales/ar";
import { api } from "./bridge";

export type LangCode = "en" | "ar";
export type LangSetting = LangCode | "auto";

const LOCALES: Record<LangCode, Locale> = { en, ar };

/** OS locale → our languages. Windows Arabic variants all map to "ar". */
function osLanguage(): LangCode {
  const langs = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : [];
  for (const l of langs) {
    const lower = (l ?? "").toLowerCase();
    if (lower.startsWith("ar")) return "ar";
  }
  return "en";
}

interface LangCtx {
  t: Locale;
  /** effective display language */
  lang: LangCode;
  /** persisted setting: "auto" | "en" | "ar" */
  setting: LangSetting;
  setLanguage: (s: LangSetting) => void;
}

const Ctx = createContext<LangCtx>({
  t: en,
  lang: "en",
  setting: "auto",
  setLanguage: () => {},
});

export function LanguageProvider(props: { children: ReactNode }) {
  const { children } = props;
  const [setting, setSetting] = useState<LangSetting>("auto");
  const [ready, setReady] = useState(false);

  // load the persisted choice once at startup
  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSetting(s.language === "en" || s.language === "ar" ? s.language : "auto");
      })
      .catch(() => setSetting("auto"))
      .finally(() => setReady(true));
  }, []);

  const lang: LangCode = setting === "auto" ? osLanguage() : setting;
  const t = LOCALES[lang];

  // flip document direction — the whole shell is logical-CSS, so this is enough
  useEffect(() => {
    document.documentElement.dir = t.lang.dir;
    document.documentElement.lang = t.lang.code;
  }, [t]);

  const setLanguage = (s: LangSetting) => {
    setSetting(s);
    void api.setLanguage(s).catch(() => {});
  };

  // don't render until the persisted language arrives — avoids a visible flip
  if (!ready) return null;
  return <Ctx.Provider value={{ t, lang, setting, setLanguage }}>{children}</Ctx.Provider>;
}

export function useLang() {
  return useContext(Ctx);
}
