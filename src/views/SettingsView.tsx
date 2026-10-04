// SettingsView.tsx — user preferences. Today: language. Tomorrow's settings
// land here too (one home for everything personal).
// Language picker: a segmented row (like the duration pills) — the app's own
// selection language: filled green on the active segment, nothing else.

import { useEffect, useState } from "react";
import { Eye, Languages, Lightbulb, RotateCcw, SunMoon, ZoomIn } from "lucide-react";
import { Button, Hint } from "../components/components";
import { api } from "../bridge";
import { useLang, type LangSetting } from "../i18n";
import { INTRO_CARDS_EVENT } from "../useIntroCard";
import { ZOOM_LEVELS } from "../useUiZoom";
import type { ThemeSetting } from "../theme";

export function SettingsView(props: {
  theme: ThemeSetting;
  onThemeChange: (v: ThemeSetting) => void;
  /** true while the Settings tab is the visible one (the re-show group
      re-reads on every visit: dismissals happen on other tabs while
      this view stays mounted, so a launch-time read would go stale) */
  active: boolean;
  /** interface zoom percent, owned by App like the theme (pills and
      shortcuts share one state through this callback) */
  zoom: number;
  onZoomChange: (pct: number) => void;
  /** reveal Tools rows the machine cannot run (owned by App: the
      gaming page link and these pills share it, persisted) */
  showUnsupported: boolean;
  onShowUnsupportedChange: (show: boolean) => void;
}) {
  const { t, setting, setLanguage } = useLang();
  const { theme, onThemeChange, active, zoom, onZoomChange, showUnsupported, onShowUnsupportedChange } = props;
  /** friendly names for the fixed steps (unknown future steps fall
      back to their number, never a wrong word) */
  const zoomLabels: Record<number, string> = {
    80: t.zoomSmall,
    100: t.zoomDefault,
    125: t.zoomLarge,
  };
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
        <section className="settings-group">
          <h3 className="settings-group-title">
            <ZoomIn size={13} />
            {t.zoomTitle}
          </h3>
          <div className="lang-segment" role="radiogroup" aria-label={t.zoomTitle}>
            {ZOOM_LEVELS.map((level) => (
              <button
                key={level}
                className={`lang-seg ${zoom === level ? "is-active" : ""}`}
                role="radio"
                aria-checked={zoom === level}
                onClick={() => onZoomChange(level)}
              >
                {zoomLabels[level] ?? `${level}%`}
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
        <section className="settings-group">
          <h3 className="settings-group-title">
            <Eye size={13} />
            {t.showUnsupportedTitle}
            <Hint text={t.showUnsupportedHint} />
          </h3>
          <div className="lang-segment" role="radiogroup" aria-label={t.showUnsupportedTitle}>
            {(
              [
                { value: false, label: t.settingOff },
                { value: true, label: t.settingOn },
              ] as const
            ).map((o) => (
              <button
                key={o.value ? "on" : "off"}
                className={`lang-seg ${showUnsupported === o.value ? "is-active" : ""}`}
                role="radio"
                aria-checked={showUnsupported === o.value}
                onClick={() => onShowUnsupportedChange(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
