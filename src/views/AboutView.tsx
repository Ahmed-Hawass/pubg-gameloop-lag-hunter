// AboutView.tsx — what the tool is, what it costs the machine, version,
// updates from GitHub, and a way to support the developer.
// Visual rule: three consistent blocks (identity → cost → updates) and a
// quiet footer — no extra elements, one rhythm.
// The update check lives in the ENGINE (Rust): the manual button asks the
// same backend command the startup check uses, then opens the SAME modal
// (manual checks ignore the once-per-version announcement on purpose).

import { useEffect, useState } from "react";
import { Coffee, Code2, Download, Heart, Leaf } from "lucide-react";
import { Button } from "../components/components";
import { api, type UpdateInfo } from "../bridge";
import { useLang } from "../i18n";
import appIcon from "../assets/app-icon.png";

const REPO_URL = "https://github.com/Ahmed-Hawass/pubg-gameloop-lag-hunter";
const SUPPORT_URL = "https://paypal.me/ahmedhawass";

export function AboutView(props: {
  /** the startup check's result — dot + "download" affordance when set */
  updateInfo: UpdateInfo | null;
  onOpenUpdateModal: () => void;
}) {
  const { t } = useLang();
  const { updateInfo, onOpenUpdateModal } = props;
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<"latest" | "err" | null>(null);
  // version from the backend — the same string tauri.conf.json owns
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    api
      .getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(""));
  }, []);

  // the startup check already knows — the dot shows immediately
  useEffect(() => {
    if (updateInfo) {
      setResult(null); // not "latest" — there IS something newer
    }
  }, [updateInfo]);

  // manual check: same engine command as startup; a found update opens the
  // modal directly (manual checks ignore once-per-version by design)
  const check = async () => {
    setChecking(true);
    setResult(null);
    try {
      const info = await api.checkUpdate();
      if (info) {
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
      <div className="about-card about-identity">
        <img className="about-mark-img" src={appIcon} alt="" width={44} height={44} draggable={false} />
        <div className="about-id-text">
          <h2 className="about-title">{t.aboutTitle}</h2>
          <span className="about-version num">{t.version} {appVersion}</span>
        </div>
        <p className="about-what">{t.aboutWhat}</p>
      </div>

      {/* block 2: cost — the five honest numbers */}
      <div className="about-card">
        <h3 className="about-h">
          <Leaf size={13} />
          {t.aboutImpact}
        </h3>
        <ul className="about-impact">
          {t.aboutImpactItems.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>

      {/* block 3: updates — the dot sits on the heading when a newer
          release exists; it is not dismissible and matches the sidebar's */}
      <div className="about-card">
        <h3 className="about-h">
          <Download size={13} />
          {t.aboutUpdate}
          {updateInfo ? <span className="about-dot" aria-label={t.updateAvailableTitle} /> : null}
        </h3>
        <div className="about-update">
          <Button
            label={checking ? t.topProcessesRefreshing : t.aboutCheckUpdate}
            icon={<Download size={14} />}
            variant="ghost"
            disabled={checking}
            onClick={() => void check()}
          />
          {result === "latest" ? <span className="about-result ok">{t.aboutUpToDate}</span> : null}
          {updateInfo ? (
            <button className="about-result update" onClick={onOpenUpdateModal}>
              {t.aboutNewVersion} (v{updateInfo.version})
            </button>
          ) : null}
          {result === "err" ? <span className="about-result err">{t.aboutUpdateErr}</span> : null}
        </div>
      </div>

      {/* footer: links + signature — same row, quiet */}
      <div className="about-footer">
        <button className="about-link" onClick={() => void api.openUrl(REPO_URL)}>
          <Code2 size={14} />
          GitHub
        </button>
        <button className="about-link support" onClick={() => void api.openUrl(SUPPORT_URL)}>
          <Coffee size={14} />
          {t.aboutSupport}
        </button>
        <span className="about-made">
          {t.aboutMade} <Heart size={11} className="about-heart" /> <span className="by">Ahmed Hawass</span>
        </span>
      </div>
    </div>
  );
}
