// clock.ts — wall-clock display for the OS 12/24 convention. Machine
// strings stay 24-hour everywhere stored (reports parse and sort from
// them); only pixels convert, through this one helper. Language comes
// from the app (user-facing strings live in the app locale) while the
// 12/24 flag comes from Windows (useHour12); the two are independent
// by design. Digits stay Latin in both languages (ar-EG alone would
// print Eastern Arabic digits against the app's Latin-numerals rule).

import type { LangCode } from "./i18n";

/** Intl formatters, one per (language, mode, seconds) shape, built once:
    feed rows format at 1 Hz and must never pay construction per tick. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(lang: LangCode, hour12: boolean, seconds: boolean): Intl.DateTimeFormat {
  const key = `${lang}|${hour12}|${seconds}`;
  const hit = formatters.get(key);
  if (hit) return hit;
  const made = new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" as const } : {}),
    hour12,
    // UTC pins the wall numbers: the input is already local time, so no
    // zone math may touch it (a midnight DST edge would otherwise move
    // the readout on the rare machines that spring forward at 00:00).
    timeZone: "UTC",
  });
  formatters.set(key, made);
  return made;
}

/** Display a stable "HH:MM" or "HH:MM:SS" machine time under the OS
    convention ("2:30 PM" / "14:30" / "2:30:05 PM"). Anything
    unparseable comes back verbatim: a clock line never goes blank and
    never throws, whatever a future producer stores. */
export function formatClockTime(time: string, hour12: boolean, lang: LangCode): string {
  const parts = time.split(":");
  if (parts.length < 2 || parts.length > 3) return time;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const s = parts.length === 3 ? Number(parts[2]) : null;
  const bad = (n: number, hi: number) => !Number.isInteger(n) || n < 0 || n > hi;
  if (bad(h, 23) || bad(m, 59) || (s !== null && bad(s, 59))) return time;
  try {
    return formatter(lang, hour12, s !== null).format(new Date(Date.UTC(2026, 0, 1, h, m, s ?? 0)));
  } catch {
    return time;
  }
}
