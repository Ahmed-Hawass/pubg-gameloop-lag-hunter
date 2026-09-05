// AboutView.tsx — what the tool is, what it costs the machine, version,
// updates from GitHub, and a way to support the developer.
// Visual rule: three consistent blocks (identity → cost → updates) and a
// quiet footer — no extra elements, one rhythm.

import { useEffect, useState } from "react";
import { Coffee, Code2, Download, Heart, Leaf } from "lucide-react";
import { Button } from "../components/components";
import { api } from "../bridge";
import { useLang } from "../i18n";
import { isNewerRelease } from "../version";
import appIcon from "../assets/app-icon.png";

const REPO_URL = "https://github.com/Ahmed-Hawass/pubg-gameloop-lag-hunter";
const RELEASES_LATEST = "https://api.github.com/repos/Ahmed-Hawass/pubg-gameloop-lag-hunter/releases/latest";
const SUPPORT_URL = "https://paypal.me/ahmedhawass";

export function AboutView(props: { updateAvailable: boolean; updateUrl: string | null }) {
  const { t } = useLang();
  const { updateAvailable, updateUrl } = props;
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<"latest" | "update" | "err" | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  // version from the backend — the same string tauri.conf.json owns
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    api
      .getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(""));
  }, []);

  // the startup check already knows — surface it immediately
  useEffect(() => {
    if (updateAvailable) {
      setResult("update");
      setDownloadUrl(updateUrl);
    }
  }, [updateAvailable, updateUrl]);

  const check = async () => {
    setChecking(true);
    setResult(null);
    setDownloadUrl(null);
    try {
      const res = await fetch(`${RELEASES_LATEST}?t=${Date.now()}`, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) throw new Error(String(res.status));
      const data: { tag_name?: string; html_url?: string } = await res.json();
      const remote = (data.tag_name ?? "").replace(/^v/, "");
      if (!remote || !appVersion) {
        // no tag or no local version → we genuinely don't know; never claim "latest"
        setResult("err");
      } else if (isNewerRelease(remote, appVersion)) {
        setResult("update");
        setDownloadUrl(data.html_url ?? REPO_URL + "/releases");
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

      {/* block 3: updates */}
      <div className="about-card">
        <h3 className="about-h">
          <Download size={13} />
          {t.aboutUpdate}
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
          {result === "update" && downloadUrl ? (
            <button className="about-result update" onClick={() => void api.openUrl(downloadUrl)}>
              {t.aboutNewVersion}
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
