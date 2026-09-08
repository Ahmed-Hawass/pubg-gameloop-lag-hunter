// theme.ts — appearance resolution. Pure logic, no DOM: given the persisted
// setting and the OS preference, decide the effective theme. The App shell
// applies it via document.documentElement.dataset.theme (tokens.css reads it).

export type ThemeSetting = "auto" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

export function resolveTheme(setting: string, systemPrefersLight: boolean): ResolvedTheme {
  if (setting === "light") return "light";
  if (setting === "dark") return "dark";
  // "auto" and anything unknown: follow the OS. Unknown values must never
  // produce a third state (defensive mirror of normalize_theme in Rust).
  return systemPrefersLight ? "light" : "dark";
}
