// TitleBar.tsx — window chrome: icon + drag + window controls.
// The sidebar collapse lives in the sidebar's bottom. Drag via
// data-tauri-drag-region. Resizable window: maximize toggles and tracks
// the maximized state for its tooltip and icon.
// ALL tooltips are the app's own (Tip component) — never the OS one.

import { useEffect, useState } from "react";
import { Minus, PictureInPicture2, Square, X } from "lucide-react";
import {
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  toggleMaximizeWindow,
} from "../bridge";
import { Tip } from "./components";
import { useLang } from "../i18n";
import appIcon from "../assets/app-icon.png";

export function TitleBar(props: {
  version: string;
  onRequestExit: () => void;
  /** a newer release is known: a quiet dot rides the version (the
      sidebar About dot and the heading dot stay the action sites) */
  updateAvailable?: boolean;
}) {
  const { t } = useLang();
  const { version, onRequestExit, updateAvailable } = props;
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
      {/* double-click the drag region toggles maximize (OS convention);
          the controls are a separate block, never inside the region */}
      <div
        className="titlebar-left"
        data-tauri-drag-region
        onDoubleClick={() => {
          void toggleMaximizeWindow();
        }}
      >
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
        {updateAvailable ? (
          <span
            className="titlebar-dot"
            role="status"
            aria-label={t.updateAvailableTitle}
          />
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
            {maximized ? <PictureInPicture2 size={11} /> : <Square size={11} />}
          </button>
        </Tip>
        <Tip text={t.close}>
          <button
            className="close"
            aria-label={t.close}
            onClick={() => {
              onRequestExit();
            }}
          >
            <X size={14} />
          </button>
        </Tip>
      </div>
    </div>
  );
}
