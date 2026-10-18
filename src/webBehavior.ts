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
  // F5 / Ctrl+R reload, F12 / Ctrl+Shift+I devtools, Ctrl+Shift+J console
  if (key === "f5" || key === "f12") return true;
  if (key === "r" && e.ctrlKey) return true;
  if ((key === "i" || key === "j") && e.ctrlKey && e.shiftKey) return true;
  // browser shortcuts that leak through: Ctrl+F find, Ctrl+P print, Ctrl+S save
  if (e.ctrlKey && ["f", "p", "s", "u"].includes(key)) return true;
  return false;
}

/** Pure decision, exposed for tests: does this selectstart target's
 *  resolved style forbid selection? Inputs, textareas and editable hosts
 *  stay selectable whatever CSS says; everything else follows its computed
 *  `user-select`, which inherits from `body { user-select: none }` and
 *  flips to `text` inside the copyable whitelist in base.css. An
 *  unresolved value stays blocked, exactly like the old blanket guard, so
 *  the fallback can only ever over-block, never leak selection. */
export function selectionBlocked(target: Element | null): boolean {
  if (!target) return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return false;
  const style = getComputedStyle(el) as CSSStyleDeclaration & { webkitUserSelect?: string };
  const select = style.userSelect || style.webkitUserSelect || "";
  return select.toLowerCase() !== "text";
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

  // 4) no accidental text selection outside the copyable surfaces — native
  // app feel. The stylesheet is the single source of truth: base.css sets
  // user-select: none on the body and text on a whitelist, and this guard
  // enforces exactly what CSS declares (reading the computed value), so a
  // surface added to the whitelist starts working without touching JS.
  document.addEventListener("selectstart", (e) => {
    if (selectionBlocked(e.target as Element | null)) e.preventDefault();
  });

  // 5) clicking empty space clears the selection. The same decision that
  // blocks a new one owns this: any spot outside every copyable surface
  // also drops the highlight already there, so a selection made inside a
  // dialog or report never lingers until the user clicks the text again
  // (a caret on user-select: none does not clear it in WebView2). Runs on
  // mousedown, the way a native window clears on the button press, and
  // never touches a control that owns its own selection.
  document.addEventListener("mousedown", (e) => {
    if (!selectionBlocked(e.target as Element | null)) return;
    window.getSelection()?.removeAllRanges();
  });
}
