// useHour12.ts — the OS clock convention (12-hour or not) for wall-clock
// display. Read once per mount from the engine's registry read (a
// microseconds call, no cache to stale): an OS change mid-run lands on
// the next mount. Unreadable means 24-hour, today's behavior exactly,
// so every consumer degrades to the status quo instead of guessing.

import { useEffect, useState } from "react";
import { api } from "./bridge";

export function useHour12(): boolean | null {
  const [hour12, setHour12] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void api
      .clockHour12()
      .then((v) => {
        if (live) setHour12(v);
      })
      .catch(() => {
        if (live) setHour12(false);
      });
    return () => {
      live = false;
    };
  }, []);
  return hour12;
}
