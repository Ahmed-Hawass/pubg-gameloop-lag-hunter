// WelcomeView.tsx — the two-slide first-run landing: what it finds,
// then how it works around one real sample finding plus what it costs.
// Shown ONCE (onboarding_done is persisted); never again after the first launch.

import { useEffect, useState } from "react";
import {
  Cpu,
  Database,
  Gamepad2,
  Globe,
  MemoryStick,
  Play,
  ShieldCheck,
} from "lucide-react";
import appIcon from "../assets/app-icon.png";
import { NoteCard, Tip, diagnosisIcon } from "../components/components";
import { useLang } from "../i18n";

export function WelcomeView(props: { onDone: () => void }) {
  const { t, lang, setLanguage } = useLang();
  const [page, setPage] = useState<0 | 1>(0);
  /** rotating sample findings (visual demo only: static translated copy
      cycling disk, cpu, gpu every few seconds — never live data) */
  const [sample, setSample] = useState(0);
  const samples = ["disk_wait", "cpu_busy", "gpu_busy"] as const;
  const sampleSev = ["medium", "high", "high"] as const;

  // slow auto-rotate while slide 2 shows: static under reduced-motion,
  // timer always cleaned (slide unmount or page leave)
  useEffect(() => {
    if (page !== 1) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      setSample((s) => (s + 1) % samples.length);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [page, samples.length]);

  return (
    <div className="welcome">
      {/* language switcher: a quiet globe in the bottom corner — one click
          toggles en/ar and persists immediately. Icon-only on purpose: this
          control is used once in the app's lifetime, so it stays out of the
          CTA flow; the full segmented picker lives in Settings. */}
      <div className="welcome-lang">
        {/* the label names the OTHER language (the one a click switches
            to) — from the locale files like every other string */}
        <Tip text={lang === "ar" ? t.langEn : t.langAr}>
          <button
            className="focus-ring welcome-lang-btn"
            onClick={() => setLanguage(lang === "ar" ? "en" : "ar")}
            aria-label={lang === "ar" ? t.langEn : t.langAr}
          >
            <Globe size={15} />
          </button>
        </Tip>
      </div>
      {/* skip: bottom end-corner (the proceed side), language owns the
          start corner — both logical, both mirror with RTL */}
      {page === 0 ? (
        <button type="button" className="focus-ring-inset welcome-skip" onClick={props.onDone}>
          {t.welcomeSkip}
        </button>
      ) : null}
      {page === 0 ? (
        <>
          <img className="welcome-icon" src={appIcon} alt="" width={64} height={64} draggable={false} />
          <h1 className="welcome-title">{t.welcomeTitle}</h1>
          <p className="welcome-what">{t.welcomeWhat}</p>

          <div className="welcome-label">{t.welcomeFindsLabel}</div>
          {/* three breathing cards (not a cramped list): tinted tile in
              the finding's own tone, name, one line */}
          <div className="welcome-finds">
            <div className="card-sm welcome-find">
              <span className="welcome-tile welcome-tile-warn">
                <Database size={19} />
              </span>
              <span className="welcome-find-title">{t.welcomeCardDisk}</span>
              <span className="welcome-find-desc">{t.welcomeFindDiskDesc}</span>
            </div>
            <div className="card-sm welcome-find">
              <span className="welcome-tile welcome-tile-bad">
                <Cpu size={19} />
              </span>
              <span className="welcome-find-title">{t.welcomeCardCpu}</span>
              <span className="welcome-find-desc">{t.welcomeFindCpuDesc}</span>
            </div>
            <div className="card-sm welcome-find">
              <span className="welcome-tile welcome-tile-ok">
                <Gamepad2 size={19} />
              </span>
              <span className="welcome-find-title">{t.welcomeCardGpu}</span>
              <span className="welcome-find-desc">{t.welcomeFindGpuDesc}</span>
            </div>
          </div>

          <button className="focus-ring btn btn-primary btn-lg welcome-cta" onClick={() => setPage(1)}>
            {t.welcomeNextBtn}
          </button>
        </>
      ) : (
        <>
          <h1 className="welcome-title">{t.welcomeHowTitle}</h1>
          <p className="welcome-what">{t.welcomeHowSub}</p>

          <div className="welcome-label">{t.welcomeSampleLabel}</div>
          {/* rotating samples: all three translated findings stacked in
              one slot, only the active visible — the slot keeps the
              tallest height so rotating never moves the tiles below */}
          <div className="welcome-sample">
            {samples.map((key, i) => (
              <div
                key={key}
                className={i === sample ? "sample-on" : "sample-off"}
                aria-hidden={i === sample ? undefined : true}
              >
                <NoteCard
                  title={t.diagnoses[key].title}
                  simple={t.diagnoses[key].simple}
                  fix={t.diagnoses[key].fix}
                  severity={sampleSev[i]}
                  fixLabel={t.fixLabel}
                  icon={diagnosisIcon(key)}
                />
              </div>
            ))}
          </div>

          <div className="welcome-label">{t.welcomeTrustTitle}</div>
          <div className="welcome-cost">
            <div className="card-sm welcome-cost-tile">
              <Cpu size={20} />
              <span className="welcome-cost-val num">{t.welcomeCostCpuVal}</span>
              <span className="welcome-cost-label">{t.welcomeCostCpuLabel}</span>
            </div>
            <div className="card-sm welcome-cost-tile">
              <MemoryStick size={20} />
              <span className="welcome-cost-val num">{t.welcomeCostRamVal}</span>
              <span className="welcome-cost-label">{t.welcomeCostRamLabel}</span>
            </div>
            <div className="card-sm welcome-cost-tile">
              <ShieldCheck size={20} />
              <span className="welcome-cost-val">{t.welcomeCostPrivacyVal}</span>
              <span className="welcome-cost-label">{t.welcomeCostPrivacyLabel}</span>
            </div>
          </div>

          <div className="welcome-nav">
            <button className="focus-ring btn btn-ghost btn-lg" onClick={() => setPage(0)}>
              {t.welcomeBack}
            </button>
            <button className="focus-ring btn btn-primary btn-lg welcome-cta" onClick={props.onDone}>
              <Play size={16} fill="currentColor" stroke="none" aria-hidden="true" />
              {t.welcomeBegin}
            </button>
          </div>
        </>
      )}
      <div className="welcome-dots" role="status" aria-label={`${page + 1} / 2`}>
        <span className={page === 0 ? "dot on" : "dot"} aria-hidden="true" />
        <span className={page === 1 ? "dot on" : "dot"} aria-hidden="true" />
      </div>
    </div>
  );
}
