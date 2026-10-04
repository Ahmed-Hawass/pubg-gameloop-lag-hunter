// useUiZoom.ts — interface zoom state (the whole window scales, like
// VS Code's zoom: layout and fonts together, zero CSS changes). One
// fixed ladder shared by pills, shortcuts, and stored values, so no
// surface can invent an off-ladder value; the engine only guards the
// 80..=125 range. Changes apply first (pixels answer instantly) then
// persist, rolling visibly back on a failed write like every other
// preference flip.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, setWebviewZoom } from "./bridge";

/** fixed zoom ladder in percent: Small, Default, Large — the only
    values the UI ever stores (pills, shortcuts, and disk speak steps,
    never free numbers, so no surface can invent an off-ladder value) */
export const ZOOM_LEVELS = [80, 100, 125];

/** nearest ladder step (first wins ties): pills highlight and stored
    values always land on a real step */
export function nearestZoomLevel(pct: number): number {
  let best = ZOOM_LEVELS[0];
  for (const level of ZOOM_LEVELS) {
    if (Math.abs(level - pct) < Math.abs(best - pct)) best = level;
  }
  return best;
}

export function useUiZoom(): {
  zoom: number;
  setZoomPct: (pct: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
} {
  const [zoom, setZoom] = useState(100);
  /** mirror for event handlers (shortcuts fire outside render and must
      never read a stale closure; updaters stay side-effect free for
      StrictMode double-invocation) */
  const zoomRef = useRef(100);
  /** apply generation: async persist confirmations (and the mount read)
      must never clobber a NEWER user action that landed while they
      were in flight — only the latest generation writes state */
  const genRef = useRef(0);
  /** true once the user changes anything: a slow mount read resolving
      afterwards must not paint over the user's own choice */
  const touchedRef = useRef(false);
  const setZoomBoth = (pct: number) => {
    zoomRef.current = pct;
    setZoom(pct);
  };
  const apply = useCallback((pct: number) => {
    const snapped = nearestZoomLevel(pct);
    const gen = ++genRef.current;
    touchedRef.current = true;
    setZoomBoth(snapped);
    void setWebviewZoom(snapped / 100).catch(() => {});
    // persist only reports failure: the just-applied value stays the
    // truth (the backend echoes ladder values back unchanged, so
    // adopting its echo could only resurrect a stale number)
    void api.setUiZoom(snapped).catch(() => {
      if (genRef.current !== gen) return;
      // storage failed: roll the pixels visibly back to the stored truth
      void api
        .getSettings()
        .then((s) => {
          if (genRef.current !== gen) return;
          const back = nearestZoomLevel(s.ui_zoom_pct ?? 100);
          setZoomBoth(back);
          return setWebviewZoom(back / 100);
        })
        .catch(() => {});
    });
  }, []);
  useEffect(() => {
    let live = true;
    void api
      .getSettings()
      .then((s) => {
        if (!live || touchedRef.current) return;
        const pct = nearestZoomLevel(s.ui_zoom_pct ?? 100);
        setZoomBoth(pct);
        void setWebviewZoom(pct / 100).catch(() => {});
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // mount read only: every change flows through apply above
  }, []);
  const step = useCallback(
    (dir: 1 | -1) => {
      const i = ZOOM_LEVELS.indexOf(nearestZoomLevel(zoomRef.current));
      apply(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, i + dir))]);
    },
    [apply],
  );
  const zoomIn = useCallback(() => step(1), [step]);
  const zoomOut = useCallback(() => step(-1), [step]);
  const resetZoom = useCallback(() => apply(100), [apply]);
  const setZoomPct = useCallback((pct: number) => apply(pct), [apply]);
  return { zoom, setZoomPct, zoomIn, zoomOut, resetZoom };
}
