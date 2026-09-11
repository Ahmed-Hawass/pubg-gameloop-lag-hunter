// TitleBar.tsx — window chrome: icon + drag + window controls.
// The sidebar collapse lives in the sidebar's bottom. Drag via
// data-tauri-drag-region. Resizable window: maximize toggles and tracks
// the maximized state for its tooltip and icon.
// ALL tooltips are the app's own (Tip component) — never the OS one.

import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tip } from "./components";
import { api } from "../bridge";
import { useLang } from "../i18n";
import appIcon from "../assets/app-icon.png";

export function TitleBar() {
  const { t } = useLang();
  const [version, setVersion] = useState<string>("");
  const [maximized, setMaximized] = useState(false);

  // the version comes from the backend (tauri.conf.json) — one source of truth
  useEffect(() => {
    api
      .getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  // track the maximized state for the toggle's tooltip and icon
  useEffect(() => {
    const win = getCurrentWindow();
    win
      .isMaximized()
      .then(setMaximized)
      .catch(() => {});
    const unlisten = win.onResized(() => {
      win
        .isMaximized()
        .then(setMaximized)
        .catch(() => {});
    });
    return () => {
      unlisten.then((f) => f()).catch(() => {});
    };
  }, []);

  return (
    <div className="titlebar">
      <div className="titlebar-left" data-tauri-drag-region>
        <img
          className="titlebar-icon"
          src={appIcon}
          alt={t.aboutTitle}
          width={20}
          height={20}
          draggable={false}
        />
        <span className="titlebar-title" data-tauri-drag-region>
          {t.aboutTitle}
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
        <Tip text={maximized ? t.restore : t.maximize}>
          <button
            onClick={() => {
              void getCurrentWindow().toggleMaximize();
            }}
          >
            {maximized ? <Copy size={11} /> : <Square size={11} />}
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
