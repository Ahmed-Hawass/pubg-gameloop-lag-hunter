// AboutView.tsx — what the tool is, what it costs the machine, version,
// updates from GitHub, and a way to support the developer.
// Visual rule: three consistent blocks (identity → cost → updates) and a
// quiet footer — no extra elements, one rhythm.
// The update check lives in the ENGINE (Rust): the manual button asks the
// same backend command the startup check uses, then opens the SAME modal
// (manual checks ignore the once-per-version announcement on purpose).

import { useEffect, useState } from "react";
import { Coffee, Code2, Cpu, Download, HardDrive, Heart, Leaf, MemoryStick, ShieldCheck, ToggleRight } from "lucide-react";
import { Button } from "../components/components";
import { api, type UpdateInfo } from "../bridge";
import { useLang } from "../i18n";
import appIcon from "../assets/app-icon.png";

const REPO_URL = "https://github.com/Ahmed-Hawass/pubg-gameloop-lag-hunter";
const SUPPORT_URL = "https://paypal.me/ahmedhawass";

/** cost-row glyphs in locale-array order (texts stay the locale array:
    zero locale churn, icons live with the layout) */
const IMPACT_ICONS = [Cpu, MemoryStick, HardDrive, ShieldCheck, ToggleRight];

export function AboutView(props: {
  /** the startup check's result — dot + "download" affordance when set */
  updateInfo: UpdateInfo | null;
  /** the running version, ASKED ONCE by App and handed down (the old
      shape paid the IPC twice: TitleBar and AboutView each asked) */
  version: string;
  onOpenUpdateModal: () => void;
  /**
   * Manual check found a newer version the startup check MISSED (e.g. the
   * app booted offline and the network came back after). App stores it
   * into its updateInfo state so the modal has something real to show —
   * the old flow opened the modal conditioned on the STALE startup result
   * (null) and a silent nothing happened despite a successful check.
   */
  onUpdateFound: (info: UpdateInfo) => void;
}) {
  const { t } = useLang();
  const { updateInfo, version, onOpenUpdateModal, onUpdateFound } = props;
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<"latest" | "err" | null>(null);
  const appVersion = version;

  // the startup check already knows — the dot shows immediately
  useEffect(() => {
    if (updateInfo) {
      setResult(null); // not "latest" — there IS something newer
    }
  }, [updateInfo]);

  // manual check: same engine command as startup; a found update is handed
  // UP to App first (it may differ from / replace the stale startup result),
  // then the modal opens on the fresh data (manual checks ignore
  // once-per-version by design)
  const check = async () => {
    setChecking(true);
    setResult(null);
    try {
      const info = await api.checkUpdate();
      if (info) {
        onUpdateFound(info);
        onOpenUpdateModal();
      } else {
        setResult("latest");
      }
    } catch {
      setResult("err");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="about">
      {/* block 1: identity — icon, name, version, one honest sentence */}
      <div className="card about-card about-identity">
        <img className="about-mark-img" src={appIcon} alt="" width={44} height={44} draggable={false} />
        <div className="about-id-text">
          <h2 className="about-title">{t.aboutTitle}</h2>
          <span className="about-version num">{t.version} {appVersion}</span>
        </div>
        <p className="about-what">{t.aboutWhat}</p>
      </div>

      {/* block 2: cost — the five honest numbers as icon rows on an
          inset divider list (same language as the sweep results) */}
      <div className="card about-card">
        <h3 className="about-h">
          <Leaf size={13} />
          {t.aboutImpact}
        </h3>
        <ul className="inset-list">
          {t.aboutImpactItems.map((item, i) => {
            const Icon = IMPACT_ICONS[i] ?? Leaf;
            return (
              <li key={i} className="inset-row">
                <Icon size={15} aria-hidden="true" />
                <span>{item}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* block 3: updates — the dot sits on the heading when a newer
          release exists; it is not dismissible and matches the sidebar's */}
      <div className="card about-card">
        <h3 className="about-h">
          <Download size={13} />
          {t.aboutUpdate}
          {updateInfo ? (
            <span
              className="about-dot"
              role="status"
              aria-label={t.updateAvailableTitle}
            />
          ) : null}
        </h3>
        <div className="about-update">
          <Button
            label={checking ? t.checkingUpdate : t.aboutCheckUpdate}
            icon={<Download size={14} />}
            variant="ghost"
            className="about-update-btn"
            disabled={checking}
            onClick={() => void check()}
          />
          {result === "latest" || updateInfo || result === "err" ? (
            <div className="about-update-result">
              {result === "latest" ? <span className="about-result ok">{t.aboutUpToDate}</span> : null}
              {updateInfo ? (
                <button className="about-result update" onClick={onOpenUpdateModal}>
                  {t.aboutNewVersion} (v{updateInfo.version})
                </button>
              ) : null}
              {result === "err" ? <span className="about-result err">{t.aboutUpdateErr}</span> : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* footer: links + signature — same row, quiet */}
      <div className="about-footer">
        <Button
          label="GitHub"
          icon={<Code2 size={14} />}
          variant="ghost"
          onClick={() => void api.openUrl(REPO_URL)}
        />
        <Button
          label={t.aboutSupport}
          icon={<Coffee size={14} />}
          variant="ghost"
          className="about-support"
          onClick={() => void api.openUrl(SUPPORT_URL)}
        />
        <span className="about-made">
          {t.aboutMade} <Heart size={11} className="about-heart" /> <span className="by">Ahmed Hawass</span>
        </span>
      </div>
    </div>
  );
}
