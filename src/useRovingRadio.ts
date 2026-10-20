// useRovingRadio.ts — the keyboard contract for the app's hand-rolled
// role="radiogroup" pills (duration, language/theme/zoom, pagefile drive/mode,
// sweep mode). One tab stop for the whole group, arrows move AND select,
// Home/End jump to the ends, and RTL flips the horizontal arrows so "right"
// still means "back" to an Arabic reader.
import { useCallback, useRef } from "react";
import type { KeyboardEvent } from "react";

const NAV_KEYS = new Set([
  "ArrowRight",
  "ArrowDown",
  "ArrowLeft",
  "ArrowUp",
  "Home",
  "End",
]);

export function useRovingRadio<T>(
  values: readonly T[],
  selected: T,
  onSelect: (value: T) => void,
) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const setItemRef = useCallback((value: T, el: HTMLButtonElement | null) => {
    if (el) refs.current.set(value, el);
    else refs.current.delete(value);
  }, []);

  // A stored value outside the offered values (a migrated duration, a drive
  // that vanished) leaves nothing checked: the first pill is the tab stop,
  // and an arrow starts from there instead of doing nothing.
  const selectedIndex = values.indexOf(selected);
  const tabbable = selectedIndex >= 0 ? selected : values[0];

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (values.length === 0 || !NAV_KEYS.has(e.key)) return;
      const base = selectedIndex >= 0 ? selectedIndex : 0;
      const rtl =
        (e.currentTarget.closest("[dir]")?.getAttribute("dir") ??
          document.documentElement.dir) === "rtl";
      let next = base;
      switch (e.key) {
        case "ArrowRight":
          next = rtl ? base - 1 : base + 1;
          break;
        case "ArrowLeft":
          next = rtl ? base + 1 : base - 1;
          break;
        case "ArrowDown":
          next = base + 1;
          break;
        case "ArrowUp":
          next = base - 1;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = values.length - 1;
          break;
      }
      next = (next + values.length) % values.length;
      e.preventDefault();
      const value = values[next];
      onSelect(value);
      refs.current.get(value)?.focus();
    },
    [onSelect, selectedIndex, values],
  );

  const tabIndexFor = useCallback(
    (value: T) => (value === tabbable ? 0 : -1),
    [tabbable],
  );

  return { onKeyDown, setItemRef, tabIndexFor };
}
