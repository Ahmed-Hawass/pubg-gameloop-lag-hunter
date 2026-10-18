// TitleBar.tsx — window chrome: icon + drag + window controls.
// The sidebar collapse lives in the sidebar's bottom. Drag via
// data-tauri-drag-region. Resizable window: maximize toggles and tracks
// the maximized state for its tooltip and icon.
// ALL tooltips are the app's own (Tip component) — never the OS one.
// The X button HIDES to the tray (never quits): Exit lives in the tray menu
// and runs the exit gate there, so a running scan survives dismissing the window.

import { useEffect, useRef, useState } from "react";
import { Minus, PictureInPicture2, Square, X } from "lucide-react";
import {
  hideWindow,
  isWindowMaximized,
  logFrontendError,
  minimizeWindow,
  onSnapOverlay,
  onWindowResized,
  syncSnapOverlay,
  toggleMaximizeWindow,
} from "../bridge";
import { Tip } from "./components";
import { useLang } from "../i18n";
import appIcon from "../assets/app-icon.png";

export function TitleBar(props: {
  version: string;
}) {
  const { t, lang } = useLang();
  const { version } = props;
  const [maximized, setMaximized] = useState(false);
  /** hover mirror for the maximize button: the native snap overlay owns
      the mouse over it, so :hover cannot fire — enter/leave drive the
      same fill instead. Keyboard focus keeps the real :focus path. */
  const [snapHover, setSnapHover] = useState(false);
  const maxBtnRef = useRef<HTMLButtonElement | null>(null);

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

  // overlay mouse reports: hover mirrors the highlight, a click runs the
  // same toggle as the button itself (the overlay owns mouse only —
  // keyboard Enter/Space still reach the real button).
  useEffect(() => {
    const unlisten = onSnapOverlay((kind) => {
      if (kind === "enter") setSnapHover(true);
      else if (kind === "leave") setSnapHover(false);
      else void toggleMaximizeWindow();
    });
    return () => {
      unlisten.then((f) => f()).catch(() => {});
    };
  }, []);

  // overlay geometry: the hit target tracks the real button rect
  // (debounced — resize fires per tick while dragging, and an invoke per
  // tick would spam the main thread with moves). Re-runs when the
  // language flips: RTL mirrors the button to the other corner.
  useEffect(() => {
    let timer = 0;
    let unlistenResize: (() => void) | undefined;
    let observer: ResizeObserver | undefined;
    const sync = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const el = maxBtnRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        void syncSnapOverlay({
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
          scale: window.devicePixelRatio || 1,
        }).catch(() => {});
      }, 120);
    };
    sync();
    if (typeof ResizeObserver !== "undefined" && maxBtnRef.current) {
      observer = new ResizeObserver(() => sync());
      observer.observe(maxBtnRef.current);
    }
    void onWindowResized(() => sync()).then((u) => {
      unlistenResize = u;
    });
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
      unlistenResize?.();
      // no stale hit area: a torn-down shell leaves nothing clickable
      void syncSnapOverlay(null).catch(() => {});
    };
  }, [lang]);

  // ONE deep drag region over the whole caption, and no double-click
  // handler of our own: Tauri injects a drag script that maximizes or
  // restores on the second mousedown inside a drag region, so a second
  // handler here sends a second toggle and the pair cancels out (the
  // window appears to ignore the double click). Deep, not bare, because a
  // bare region only fires on its own element: that left the icon and the
  // gap around the title outside the drag. The controls sit inside the bar
  // yet never drag: a BUTTON in the path blocks the region.
  return (
    <div className="titlebar" data-tauri-drag-region="deep">
      <div className="titlebar-left">
        <img
          className="titlebar-icon"
          src={appIcon}
          alt={t.aboutTitle}
          width={20}
          height={20}
          draggable={false}
        />
        <span className="titlebar-title">{t.aboutTitle}</span>
        {version ? (
          <span className="titlebar-version num">v{version}</span>
        ) : null}
      </div>
      <div className="win-controls">
        {/* icon-only buttons carry their accessible name: the tooltip
            paints on hover only, so without aria-labels the window
            controls are unnamed for screen readers and keyboard users */}
        <Tip text={t.minimize}>
          <button
            className="focus-ring-inset"
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
            ref={maxBtnRef}
            className={`focus-ring-inset${snapHover ? " snap-hover" : ""}`}
            aria-label={maximized ? t.restore : t.maximize}
            onClick={() => {
              void toggleMaximizeWindow();
            }}
          >
            {maximized ? <PictureInPicture2 size={13} /> : <Square size={13} />}
          </button>
        </Tip>
        <Tip text={t.hideToTray}>
          <button
            className="focus-ring-inset close"
            aria-label={t.hideToTray}
            onClick={() => {
              void hideWindow().catch((e) => {
                void logFrontendError(`hide window failed: ${String(e)}`).catch(() => {});
              });
            }}
          >
            <X size={13} />
          </button>
        </Tip>
      </div>
    </div>
  );
}
