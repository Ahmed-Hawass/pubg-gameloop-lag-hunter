// SettingsView.tsx — user preferences. Today: language. Tomorrow's settings
// land here too (one home for everything personal).
// Language picker: a segmented row (like the duration pills) — the app's own
// selection language: filled green on the active segment, nothing else.

import { Languages, SunMoon } from "lucide-react";
import { useLang, type LangSetting } from "../i18n";
import type { ThemeSetting } from "../theme";

export function SettingsView(props: {
  theme: ThemeSetting;
  onThemeChange: (v: ThemeSetting) => void;
}) {
  const { t, setting, setLanguage } = useLang();
  const { theme, onThemeChange } = props;

  const options: { key: LangSetting; label: string }[] = [
    // every label comes from the locale like the rest of the UI — the
    // old hardcoded "English"/"العربية" literals duplicated the dead
    // lang.label key and skipped translation entirely
    { key: "auto", label: t.themeAuto },
    { key: "en", label: t.langEn },
    { key: "ar", label: t.langAr },
  ];

  const themeOptions: { key: ThemeSetting; label: string }[] = [
    { key: "auto", label: t.themeAuto },
    { key: "dark", label: t.themeDark },
    { key: "light", label: t.themeLight },
  ];

  return (
    <div className="settings-page">
      <section className="settings-group">
        <h3 className="settings-group-title">
          <Languages size={13} />
          {t.language}
        </h3>
        <div className="lang-segment" role="radiogroup" aria-label={t.language}>
          {options.map((o) => (
            <button
              key={o.key}
              className={`lang-seg ${setting === o.key ? "is-active" : ""}`}
              // radio semantics for screen readers: without role/checked
              // the group announces no selectable state at all
              role="radio"
              aria-checked={setting === o.key}
              onClick={() => setLanguage(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>
      <section className="settings-group">
        <h3 className="settings-group-title">
          <SunMoon size={13} />
          {t.theme}
        </h3>
        <div className="lang-segment" role="radiogroup" aria-label={t.theme}>
          {themeOptions.map((o) => (
            <button
              key={o.key}
              className={`lang-seg ${theme === o.key ? "is-active" : ""}`}
              role="radio"
              aria-checked={theme === o.key}
              onClick={() => onThemeChange(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
