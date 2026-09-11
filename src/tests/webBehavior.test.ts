// webBehavior.test.ts — the browser-habit guard, as tests.
// The bug class this guards: a leaked browser shortcut (reload, devtools,
// find, print, save) re-painting the WebView mid-session, or an app key
// (copy, arrows, plain typing) being swallowed.

import { describe, expect, it } from "vitest";
import { isBrowserShortcut } from "../webBehavior";

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
});
