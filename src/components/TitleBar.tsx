// TitleBar.tsx — window chrome: icon + drag + window controls.
// The sidebar collapse lives in the sidebar's bottom. Drag via
// data-tauri-drag-region. Resizable window: maximize toggles and tracks
// the maximized state for its tooltip and icon.
// ALL tooltips are the app's own (Tip component) — never the OS one.

import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  toggleMaximizeWindow,
} from "../bridge";
import { Tip } from "./components";
import { useLang } from "../i18n";
import appIcon from "../assets/app-icon.png";

export function TitleBar(props: { version: string }) {
  const { t } = useLang();
  const { version } = props;
  const [maximized, setMaximized] = useState(false);

  // track the maximized state for the toggle's tooltip and icon
  useEffect(() => {
    isWindowMaximized()
      .then(setMaximized)
      .catch(() => {});
    const unlisten = onWindowResized(() => {
      isWindowMaximized()
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
        {/* icon-only buttons carry their accessible name: the tooltip
            paints on hover only, so without aria-labels the window
            controls are unnamed for screen readers and keyboard users */}
        <Tip text={t.minimize}>
          <button
            aria-label={t.minimize}
            onClick={() => {
              void minimizeWindow();
            }}
          >
            <Minus size={13} />
          </button>
        </Tip>
        <Tip text={maximized ? t.restore : t.maximize}>
          <button
            aria-label={maximized ? t.restore : t.maximize}
            onClick={() => {
              void toggleMaximizeWindow();
            }}
          >
            {maximized ? <Copy size={11} /> : <Square size={11} />}
          </button>
        </Tip>
        <Tip text={t.close}>
          <button
            className="close"
            aria-label={t.close}
            onClick={() => {
              void closeWindow();
            }}
          >
            <X size={14} />
          </button>
        </Tip>
      </div>
    </div>
  );
}
