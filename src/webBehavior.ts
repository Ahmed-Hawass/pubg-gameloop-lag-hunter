// webBehavior.ts — remove every browser habit from the app window.
// Official Tauri practice: the WebView is a browser; these guards make it feel native.
// Registered once at startup (main.tsx).

export function installNativeBehavior() {
  // 1) no right-click context menu
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  // 2) no F5 / Ctrl+R reload, no F12/Ctrl+Shift+I devtools shortcuts
  document.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (key === "f5" || (key === "r" && e.ctrlKey)) {
      e.preventDefault();
    }
    if (key === "f12" || (key === "i" && e.ctrlKey && e.shiftKey)) {
      e.preventDefault();
    }
    // block browser shortcuts that leak through: Ctrl+F find, Ctrl+P print, Ctrl+S save
    if (e.ctrlKey && ["f", "p", "s", "u"].includes(key)) {
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
