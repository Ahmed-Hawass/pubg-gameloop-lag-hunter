// useIntervalTick.ts — the one shared poll wiring: interval plus
// off-tab plus hidden-document skip plus cleanup. The tick BODY stays
// with the caller (every load owns its own silent/force and busy
// contract); a ref carries the latest closure so the timer neither
// resets on every render nor calls a stale load.

import { useEffect, useRef } from "react";

export function useIntervalTick(active: boolean, ms: number, onTick: () => void): void {
  const tickRef = useRef(onTick);
  // latest closure without re-subscribing the timer every render
  useEffect(() => {
    tickRef.current = onTick;
  });
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      tickRef.current();
    }, ms);
    return () => window.clearInterval(timer);
  }, [active, ms]);
}
