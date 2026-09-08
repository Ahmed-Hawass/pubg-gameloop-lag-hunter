// WelcomeView.tsx — the two-page first-run landing: identity, then trust.
// Shown ONCE (onboarding_done is persisted); never again after the first launch.

import { useState } from "react";
import { Check, Cpu, Gauge, Globe, HardDrive, Leaf, Play } from "lucide-react";
import appIcon from "../assets/app-icon.png";
import { Tip } from "../components/components";
import { useLang } from "../i18n";

export function WelcomeView(props: { onDone: () => void }) {
  const { t, lang, setLanguage } = useLang();
  const [page, setPage] = useState<0 | 1>(0);

  return (
    <div className="welcome">
      {/* language switcher: a quiet globe in the bottom corner — one click
          toggles en/ar and persists immediately. Icon-only on purpose: this
          control is used once in the app's lifetime, so it stays out of the
          CTA flow; the full segmented picker lives in Settings. */}
      <div className="welcome-lang">
        <Tip text={lang === "ar" ? "English" : "العربية"}>
          <button
            className="welcome-lang-btn"
            onClick={() => setLanguage(lang === "ar" ? "en" : "ar")}
            aria-label={lang === "ar" ? "English" : "العربية"}
          >
            <Globe size={15} />
          </button>
        </Tip>
      </div>
      {page === 0 ? (
        <>
          <img className="welcome-icon" src={appIcon} alt="" width={64} height={64} draggable={false} />
          <h1 className="welcome-title">{t.welcomeTitle}</h1>
          <p className="welcome-what">{t.welcomeWhat}</p>

          <div className="welcome-cards">
            <div className="welcome-card">
              <HardDrive size={20} />
              <span>{t.welcomeCardDisk}</span>
            </div>
            <div className="welcome-card">
              <Cpu size={20} />
              <span>{t.welcomeCardCpu}</span>
            </div>
            <div className="welcome-card">
              <Gauge size={20} />
              <span>{t.welcomeCardGpu}</span>
            </div>
          </div>

          <button className="btn btn-primary btn-lg welcome-cta" onClick={() => setPage(1)}>
            {t.welcomeNext}
          </button>
        </>
      ) : (
        <>
          <Leaf size={44} className="welcome-leaf" />
          <h1 className="welcome-title">{t.welcomeTrustTitle}</h1>

          <ul className="welcome-trust">
            {t.aboutImpactItems.map((item, i) => (
              <li key={i}>
                <Check size={15} />
                {item}
              </li>
            ))}
          </ul>

          <button className="btn btn-primary btn-lg welcome-cta" onClick={props.onDone}>
            <Play size={16} />
            {t.welcomeBegin}
          </button>
        </>
      )}
      <div className="welcome-dots" aria-hidden="true">
        <span className={page === 0 ? "dot on" : "dot"} />
        <span className={page === 1 ? "dot on" : "dot"} />
      </div>
    </div>
  );
}
