// TitleBar.tsx — window chrome: icon + drag + window controls.
// The sidebar collapse lives in the sidebar's bottom. Drag via
// data-tauri-drag-region. Fixed-size window: maximize visible but disabled.
// ALL tooltips are the app's own (Tip component) — never the OS one.

import { useEffect, useState } from "react";
import { Copy, Minus, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tip } from "./components";
import { api } from "../bridge";
import { useLang } from "../i18n";
import appIcon from "../assets/app-icon.png";

export function TitleBar() {
  const { t } = useLang();
  const [version, setVersion] = useState<string>("");

  // the version comes from the backend (tauri.conf.json) — one source of truth
  useEffect(() => {
    api
      .getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  return (
    <div className="titlebar">
      <div className="titlebar-left" data-tauri-drag-region>
        <img className="titlebar-icon" src={appIcon} alt="PUBG GameLoop Lag Hunter" width={20} height={20} draggable={false} />
        <span className="titlebar-title" data-tauri-drag-region>
          PUBG GameLoop Lag Hunter
        </span>
        {version ? (
          <span className="titlebar-version num" data-tauri-drag-region>
            v{version}
          </span>
        ) : null}
      </div>
      <div className="win-controls">
        <Tip text={t.minimize}>
          <button
            onClick={() => {
              void getCurrentWindow().minimize();
            }}
          >
            <Minus size={13} />
          </button>
        </Tip>
        {/* fixed-size window: the affordance stays, just disabled */}
        <Tip text={t.maximize}>
          <button className="is-disabled" disabled>
            <Copy size={11} />
          </button>
        </Tip>
        <Tip text={t.close}>
          <button
            className="close"
            onClick={() => {
              void getCurrentWindow().close();
            }}
          >
            <X size={14} />
          </button>
        </Tip>
      </div>
    </div>
  );
}
