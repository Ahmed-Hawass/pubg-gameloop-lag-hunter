// SettingsView.tsx — user preferences. Today: language. Tomorrow's settings
// land here too (one home for everything personal).
// Language picker: a segmented row (like the duration pills) — the app's own
// selection language: filled green on the active segment, nothing else.

import { Languages } from "lucide-react";
import { useLang, type LangSetting } from "../i18n";

export function SettingsView() {
  const { t, setting, setLanguage } = useLang();

  const options: { key: LangSetting; label: string }[] = [
    { key: "auto", label: t.lang.code === "ar" ? "تلقائي" : "Automatic" },
    { key: "en", label: "English" },
    { key: "ar", label: "العربية" },
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
              onClick={() => setLanguage(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
