// webBehavior.test.ts — the browser-habit guard, as tests.
// The bug class this guards: a leaked browser shortcut (reload, devtools,
// find, print, save) re-painting the WebView mid-session, an app key
// (copy, arrows, plain typing) being swallowed, or a selection that can be
// started where it should not and then never cleared.

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installNativeBehavior, isBrowserShortcut, selectionBlocked } from "../webBehavior";

const ev = (key: string, opts?: { ctrl?: boolean; shift?: boolean }) => ({
  key,
  ctrlKey: opts?.ctrl ?? false,
  shiftKey: opts?.shift ?? false,
});

describe("isBrowserShortcut", () => {
  it("blocks reload and devtools keys", () => {
    expect(isBrowserShortcut(ev("F5"))).toBe(true);
    expect(isBrowserShortcut(ev("f5"))).toBe(true);
    expect(isBrowserShortcut(ev("F12"))).toBe(true);
    expect(isBrowserShortcut(ev("R", { ctrl: true }))).toBe(true);
    expect(isBrowserShortcut(ev("I", { ctrl: true, shift: true }))).toBe(true);
    // Ctrl+Shift+J is the devtools console — same class as Ctrl+Shift+I
    expect(isBrowserShortcut(ev("J", { ctrl: true, shift: true }))).toBe(true);
  });

  it("blocks the leak-through Ctrl combos: find, print, save, view-source", () => {
    for (const k of ["f", "p", "s", "u"]) {
      expect(isBrowserShortcut(ev(k, { ctrl: true }))).toBe(true);
    }
  });

  it("lets plain typing and everyday app keys through", () => {
    expect(isBrowserShortcut(ev("r"))).toBe(false);
    expect(isBrowserShortcut(ev("i"))).toBe(false);
    expect(isBrowserShortcut(ev("f"))).toBe(false);
    expect(isBrowserShortcut(ev("F1"))).toBe(false);
    expect(isBrowserShortcut(ev("ArrowLeft"))).toBe(false);
    expect(isBrowserShortcut(ev("Enter"))).toBe(false);
    expect(isBrowserShortcut(ev("5"))).toBe(false);
  });

  it("lets real app shortcuts through: copy, paste, cut, select-all", () => {
    for (const k of ["c", "v", "x", "a"]) {
      expect(isBrowserShortcut(ev(k, { ctrl: true }))).toBe(false);
    }
  });

  it("Ctrl+Shift+I is devtools, but Ctrl+I alone is not", () => {
    expect(isBrowserShortcut(ev("i", { ctrl: true }))).toBe(false);
    expect(isBrowserShortcut(ev("i", { shift: true }))).toBe(false);
  });

  it("Ctrl+Shift+J is the console, but plain J / Ctrl+J are not", () => {
    expect(isBrowserShortcut(ev("j"))).toBe(false);
    expect(isBrowserShortcut(ev("j", { ctrl: true }))).toBe(false);
    expect(isBrowserShortcut(ev("j", { shift: true }))).toBe(false);
  });
});

// the selectstart guard reads the resolved user-select, so base.css stays
// the only place that decides what copies. getComputedStyle is mocked:
// jsdom loads no stylesheet, so the real value never shows up here.
const styleWith = (overrides: { userSelect?: string; webkitUserSelect?: string }) =>
  vi.spyOn(window, "getComputedStyle").mockReturnValue(overrides as unknown as CSSStyleDeclaration);

const node = (tag = "div", opts?: { editable?: boolean }) => {
  const el = document.createElement(tag);
  if (opts?.editable) Object.defineProperty(el, "isContentEditable", { value: true });
  return el;
};

describe("selectionBlocked", () => {
  afterEach(() => vi.restoreAllMocks());

  it("blocks selection where the stylesheet leaves user-select: none", () => {
    styleWith({ userSelect: "none" });
    expect(selectionBlocked(node("div"))).toBe(true);
  });

  it("allows selection inside the whitelisted surfaces (user-select: text)", () => {
    styleWith({ userSelect: "text" });
    expect(selectionBlocked(node("div"))).toBe(false);
  });

  it("reads the -webkit-user-select fallback", () => {
    styleWith({ userSelect: "", webkitUserSelect: "text" });
    expect(selectionBlocked(node("div"))).toBe(false);
  });

  it("keeps inputs, textareas and editable hosts selectable whatever CSS says", () => {
    styleWith({ userSelect: "none" });
    expect(selectionBlocked(node("input"))).toBe(false);
    expect(selectionBlocked(node("textarea"))).toBe(false);
    expect(selectionBlocked(node("div", { editable: true }))).toBe(false);
  });

  it("an unresolved value stays blocked and a missing target is a no-op", () => {
    styleWith({ userSelect: "" });
    expect(selectionBlocked(node("div"))).toBe(true);
    expect(selectionBlocked(null)).toBe(false);
  });
});

// base.css owns the whitelist; this pins the minimum copyable surfaces so a
// future stylesheet edit cannot silently close one of them.
describe("selection whitelist (base.css)", () => {
  const css = readFileSync(path.resolve(process.cwd(), "src/styles/base.css"), "utf8");

  it("re-enables selection inside every copyable surface", () => {
    for (const selector of [
      ".dialog-box",
      ".um-notes",
      ".note-title",
      ".note-body",
      ".note-fix-box",
      ".report-moments",
      ".report-metrics",
      ".intro-card",
      ".empty-title",
      ".empty-hint",
      ".page-head-sub",
      ".checks-hint",
      ".tool-note",
    ]) {
      expect(css).toContain(selector);
    }
  });
});

// clearing the highlight on a click is the mirror of blocking a new one:
// WebView2 keeps a selection made inside a copyable surface alive through
// every click on user-select: none, so without this the user could only
// clear it by clicking the text again.
describe("clicking empty space clears the selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("drops the highlight on a blocked spot, keeps it on a selectable one", () => {
    installNativeBehavior();
    const copyable = document.createElement("div");
    copyable.textContent = "notes worth copying";
    const empty = document.createElement("div");
    document.body.append(copyable, empty);

    // the resolved style base.css declares: text inside the whitelist,
    // none everywhere else
    vi.spyOn(window, "getComputedStyle").mockImplementation((el) =>
      (el === copyable
        ? { userSelect: "text" }
        : { userSelect: "none" }) as unknown as CSSStyleDeclaration,
    );

    const range = document.createRange();
    range.selectNodeContents(copyable);
    const sel = window.getSelection();
    expect(sel).not.toBeNull();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(sel?.rangeCount).toBe(1);

    // a press on the text itself must not clear it (that press is what
    // starts or extends a selection in the first place)
    copyable.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(sel?.rangeCount).toBe(1);

    // a press on empty space clears it, the way a native window does
    empty.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(sel?.rangeCount).toBe(0);
  });
});
