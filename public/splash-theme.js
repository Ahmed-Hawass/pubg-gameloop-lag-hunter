// splash-theme.js: boot splash theme before first paint (no IPC yet).
// External file (not inline) so the Tauri CSP `script-src 'self'` holds.
// Follows the OS preference; a saved app theme contradicting the OS flips
// one frame later with the main.tsx seed (same accepted caveat, no requests).
try {
  document.documentElement.dataset.splash = window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
} catch {
  /* no DOM or matchMedia (very old engine): splash stays dark, app still boots */
}
