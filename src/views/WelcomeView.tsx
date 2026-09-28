// WelcomeView.tsx — the three-slide first-run landing: what it finds,
// how it works (with a real sample finding), what it costs.
// Shown ONCE (onboarding_done is persisted); never again after the first launch.

import { useEffect, useState } from "react";
import {
  Cpu,
  Database,
  FileText,
  Gamepad2,
  Globe,
  HardDrive,
  Leaf,
  MemoryStick,
  Play,
  ShieldCheck,
} from "lucide-react";
import appIcon from "../assets/app-icon.png";
import { NoteCard, Tip, diagnosisIcon } from "../components/components";
import { useLang } from "../i18n";

export function WelcomeView(props: { onDone: () => void }) {
  const { t, lang, setLanguage } = useLang();
  const [page, setPage] = useState<0 | 1 | 2>(0);
  /** rotating sample finding (visual demo only: static translated copy
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
            className="welcome-lang-btn"
            onClick={() => setLanguage(lang === "ar" ? "en" : "ar")}
            aria-label={lang === "ar" ? t.langEn : t.langAr}
          >
            <Globe size={15} />
          </button>
        </Tip>
      </div>
      {/* skip: bottom end-corner (the proceed side), language owns the
          start corner — both logical, both mirror with RTL */}
      {page < 2 ? (
        <button type="button" className="welcome-skip" onClick={props.onDone}>
          {t.welcomeSkip}
        </button>
      ) : null}
      {page === 0 ? (
        <>
          <img className="welcome-icon" src={appIcon} alt="" width={64} height={64} draggable={false} />
          <h1 className="welcome-title">{t.welcomeTitle}</h1>
          <p className="welcome-what">{t.welcomeWhat}</p>

          <div className="welcome-label">{t.welcomeFindsLabel}</div>
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

          <button className="btn btn-primary btn-lg welcome-cta" onClick={() => setPage(1)}>
            {t.welcomeNextBtn}
          </button>
        </>
      ) : page === 1 ? (
        <>
          <h1 className="welcome-title">{t.welcomeStepsTitle}</h1>
          <p className="welcome-what">{t.welcomeStepsSub}</p>

          <div className="welcome-finds">
            <div className="card-sm welcome-find">
              <span className="welcome-step-top">
                <span className="welcome-tile welcome-tile-brand">
                  <Play size={19} />
                </span>
                <span className="welcome-step-num num">1</span>
              </span>
              <span className="welcome-find-title">{t.welcomeStep1Title}</span>
              <span className="welcome-find-desc">{t.welcomeStep1Desc}</span>
            </div>
            <div className="card-sm welcome-find">
              <span className="welcome-step-top">
                <span className="welcome-tile welcome-tile-brand">
                  <Gamepad2 size={19} />
                </span>
                <span className="welcome-step-num num">2</span>
              </span>
              <span className="welcome-find-title">{t.welcomeStep2Title}</span>
              <span className="welcome-find-desc">{t.welcomeStep2Desc}</span>
            </div>
            <div className="card-sm welcome-find">
              <span className="welcome-step-top">
                <span className="welcome-tile welcome-tile-brand">
                  <FileText size={19} />
                </span>
                <span className="welcome-step-num num">3</span>
              </span>
              <span className="welcome-find-title">{t.welcomeStep3Title}</span>
              <span className="welcome-find-desc">{t.welcomeStep3Desc}</span>
            </div>
          </div>

          <div className="welcome-label">{t.welcomeSampleLabel}</div>
          {/* rotating samples: the translated finding copies, exactly as
              findings render in-app (visual demo, keyed swap re-runs a
              quiet fade — no sliding motion anywhere) */}
          <div className="welcome-sample" key={samples[sample]}>
            <NoteCard
              title={t.diagnoses[samples[sample]].title}
              simple={t.diagnoses[samples[sample]].simple}
              fix={t.diagnoses[samples[sample]].fix}
              severity={sampleSev[sample]}
              fixLabel={t.fixLabel}
              icon={diagnosisIcon(samples[sample])}
            />
          </div>

          <div className="welcome-nav">
            <button className="btn btn-ghost btn-lg" onClick={() => setPage(0)}>
              {t.welcomeBack}
            </button>
            <button className="btn btn-primary btn-lg welcome-cta" onClick={() => setPage(2)}>
              {t.welcomeNextBtn}
            </button>
          </div>
        </>
      ) : (
        <>
          <Leaf size={44} className="welcome-leaf" />
          <h1 className="welcome-title">{t.welcomeTrustTitle}</h1>
          <p className="welcome-what">{t.welcomeTrustSub}</p>

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
              <HardDrive size={20} />
              <span className="welcome-cost-val num">{t.welcomeCostDiskVal}</span>
              <span className="welcome-cost-label">{t.welcomeCostDiskLabel}</span>
            </div>
            <div className="card-sm welcome-cost-tile">
              <ShieldCheck size={20} />
              <span className="welcome-cost-val">{t.welcomeCostPrivacyVal}</span>
              <span className="welcome-cost-label">{t.welcomeCostPrivacyLabel}</span>
            </div>
          </div>

          <div className="welcome-nav">
            <button className="btn btn-ghost btn-lg" onClick={() => setPage(1)}>
              {t.welcomeBack}
            </button>
            <button className="btn btn-primary btn-lg welcome-cta" onClick={props.onDone}>
              <Play size={16} />
              {t.welcomeBegin}
            </button>
          </div>
        </>
      )}
      <div className="welcome-dots" aria-hidden="true">
        <span className={page === 0 ? "dot on" : "dot"} />
        <span className={page === 1 ? "dot on" : "dot"} />
        <span className={page === 2 ? "dot on" : "dot"} />
      </div>
    </div>
  );
}
