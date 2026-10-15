// useSpotTheme.ts — resolved theme for the Tools landing spot art.
// Subscribes to the shell's data-theme so a theme flip while on the
// landing swaps art without waiting for another render.

import { useEffect, useState } from "react";

export function useSpotTheme(): string {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme ?? "dark",
  );
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => {
      setTheme(el.dataset.theme ?? "dark");
    });
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}
