// SettingsView.tsx — user preferences. Today: language. Tomorrow's settings
// land here too (one home for everything personal).
// Language picker: a segmented row (like the duration pills) — the app's own
// selection language: filled green on the active segment, nothing else.

import { useEffect, useState } from "react";
import { Languages, Lightbulb, RotateCcw, SunMoon } from "lucide-react";
import { Button, Hint } from "../components/components";
import { api } from "../bridge";
import { useLang, type LangSetting } from "../i18n";
import { INTRO_CARDS_EVENT } from "../useIntroCard";
import type { ThemeSetting } from "../theme";

export function SettingsView(props: {
  theme: ThemeSetting;
  onThemeChange: (v: ThemeSetting) => void;
  /** true while the Settings tab is the visible one (the re-show group
      re-reads on every visit: dismissals happen on other tabs while
      this view stays mounted, so a launch-time read would go stale) */
  active: boolean;
}) {
  const { t, setting, setLanguage } = useLang();
  const { theme, onThemeChange, active } = props;
  /** dismissed intro cards count (null = unread yet): the re-show
      group renders only while something is actually dismissed (a
      button with nothing to restore would be a dead control) */
  const [dismissedCount, setDismissedCount] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const read = () => {
      void api
        .getSettings()
        .then((s) => setDismissedCount((s.dismissed_cards ?? []).length))
        .catch(() => {});
    };
    read();
  }, [active]);
  /** re-show every dismissed intro card: optimistic hide (the group
      leaves at once), rollback on a failed write, then one local
      signal so mounted sections re-read without a restart */
  const resetCards = () => {
    setDismissedCount(0);
    void api
      .resetIntroCards()
      .then(() => {
        window.dispatchEvent(new Event(INTRO_CARDS_EVENT));
      })
      .catch(() => {
        void api
          .getSettings()
          .then((s) => setDismissedCount((s.dismissed_cards ?? []).length))
          .catch(() => {});
      });
  };

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
      {/* one card for every personal preference (today language and
          theme, tomorrow's settings land in here too) */}
      <div className="card settings-card">
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
        {dismissedCount !== null && dismissedCount > 0 ? (
          <section className="settings-group">
            <h3 className="settings-group-title">
              <Lightbulb size={13} />
              {t.introResetTitle}
              <Hint text={t.introResetHint} />
            </h3>
            <Button
              label={t.introResetAction}
              icon={<RotateCcw size={14} />}
              variant="ghost"
              onClick={resetCards}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}
