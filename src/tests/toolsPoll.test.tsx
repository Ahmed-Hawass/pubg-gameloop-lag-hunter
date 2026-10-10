// tests/toolsPoll.test.tsx — the Tools backstop contract: an external
// change while a details page sits open (GameLoop update, another tool,
// policy) surfaces within a minute via a cheap re-read, skipped
// mid-flip, off-tab, and while the document is hidden.
//
// Timing style follows welcome.test.tsx: fake timers plus sync act
// flushes, never waitFor (which deadlocks under fake timers and hung
// this whole file once).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { en } from "../locales/en";
import { GamingSection } from "../views/tools/GamingSection";
import { StorageSection } from "../views/tools/StorageSection";
import { tweakStates } from "./fixtures";

const apiMock = vi.hoisted(() => ({
  tweakStates: vi.fn(),
  setTweak: vi.fn(),
  openWindowsPanel: vi.fn(),
}));

vi.mock("../bridge", () => ({
  api: apiMock,
  notifyFeatureStateChanged: vi.fn(),
}));

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
}));

function setVisibility(v: string) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => v,
  });
}

afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
});

function gamingCalls() {
  return apiMock.tweakStates.mock.calls.length;
}

describe("Tools backstop poll", () => {
  it("gaming re-reads within a minute while visible", async () => {
    vi.useFakeTimers();
    try {
      setVisibility("visible");
      apiMock.tweakStates.mockResolvedValue(tweakStates());
      render(
        <GamingSection
          active
          linkTarget={null}
          onLinkDone={vi.fn()}
          showHint={vi.fn()}
          failNotice={vi.fn()}
          showUnsupported={false}
          onShowUnsupported={vi.fn()}
        />,
      );
      await act(async () => {});
      expect(gamingCalls()).toBe(1);
      await act(async () => {
        vi.advanceTimersByTime(60000);
      });
      await act(async () => {});
      expect(gamingCalls()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gaming skips the tick while hidden", async () => {
    vi.useFakeTimers();
    try {
      setVisibility("visible");
      apiMock.tweakStates.mockResolvedValue(tweakStates());
      render(
        <GamingSection
          active
          linkTarget={null}
          onLinkDone={vi.fn()}
          showHint={vi.fn()}
          failNotice={vi.fn()}
          showUnsupported={false}
          onShowUnsupported={vi.fn()}
        />,
      );
      await act(async () => {});
      expect(gamingCalls()).toBe(1);
      setVisibility("hidden");
      await act(async () => {
        vi.advanceTimersByTime(120000);
      });
      await act(async () => {});
      expect(gamingCalls()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("storage re-reads within a minute while visible", async () => {
    vi.useFakeTimers();
    try {
      setVisibility("visible");
      apiMock.tweakStates.mockResolvedValue(tweakStates());
      render(
        <StorageSection active showHint={vi.fn()} failNotice={vi.fn()} />,
      );
      await act(async () => {});
      expect(gamingCalls()).toBe(1);
      await act(async () => {
        vi.advanceTimersByTime(60000);
      });
      await act(async () => {});
      expect(gamingCalls()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
