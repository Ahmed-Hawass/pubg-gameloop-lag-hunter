// webBehavior.ts — remove every browser habit from the app window.
// Official Tauri practice: the WebView is a browser; these guards make it feel native.
// Registered once at startup (main.tsx).

/** Pure decision: should this keydown be swallowed as a browser habit?
 *  Exposed for tests — the DOM listener below only wires it up. */
export function isBrowserShortcut(e: {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
}): boolean {
  const key = e.key.toLowerCase();
  // F5 / Ctrl+R reload, F12 / Ctrl+Shift+I devtools
  if (key === "f5" || key === "f12") return true;
  if (key === "r" && e.ctrlKey) return true;
  if (key === "i" && e.ctrlKey && e.shiftKey) return true;
  // browser shortcuts that leak through: Ctrl+F find, Ctrl+P print, Ctrl+S save
  if (e.ctrlKey && ["f", "p", "s", "u"].includes(key)) return true;
  return false;
}

export function installNativeBehavior() {
  // 1) no right-click context menu
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  // 2) no reload / devtools / find / print / save shortcuts
  document.addEventListener("keydown", (e) => {
    if (isBrowserShortcut(e)) {
      e.preventDefault();
    }
  });

  // 3) no text/image drag-and-drop from outside (feels broken in a desktop app)
  ["dragover", "drop"].forEach((ev) =>
    document.addEventListener(ev, (e) => e.preventDefault()),
  );

  // 4) no accidental text selection outside inputs — native app feel
  document.addEventListener("selectstart", (e) => {
    const t = e.target as HTMLElement;
    if (!t.isContentEditable && t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") {
      e.preventDefault();
    }
  });
}
