// tests/welcome.test.tsx — the three-slide onboarding contract: dots
// track the slide, Back returns, Skip finishes like Begin, and the
// middle slide shows a real translated finding (never mock copy).

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { WelcomeView } from "../views/WelcomeView";

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
}));

function open(onDone?: () => void) {
  const done = onDone ?? vi.fn();
  render(React.createElement(WelcomeView, { onDone: done }));
  return { done };
}

describe("WelcomeView slides", () => {
  it("walks identity, steps, cost with Back returning", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText(en.welcomeFindsLabel);
    await user.click(screen.getByText(en.welcomeNextBtn));
    await screen.findByText(en.welcomeStepsTitle);
    // the sample is the real translated finding, not mock copy
    expect(screen.getByText(en.diagnoses.disk_wait.title)).toBeTruthy();
    await user.click(screen.getByText(en.welcomeBack));
    await screen.findByText(en.welcomeFindsLabel);
    await user.click(screen.getByText(en.welcomeNextBtn));
    await user.click(screen.getByText(en.welcomeNextBtn));
    await screen.findByText(en.welcomeTrustTitle);
    expect(screen.getByText(en.welcomeCostPrivacyLabel)).toBeTruthy();
  });

  it("Skip finishes onboarding exactly like Begin", async () => {
    const user = userEvent.setup();
    const { done } = open();
    await screen.findByText(en.welcomeFindsLabel);
    await user.click(screen.getByText(en.welcomeSkip));
    expect(done).toHaveBeenCalledOnce();
  });

  it("no Skip on the last slide: Begin owns the finish there", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText(en.welcomeFindsLabel);
    await user.click(screen.getByText(en.welcomeNextBtn));
    await user.click(screen.getByText(en.welcomeNextBtn));
    await screen.findByText(en.welcomeTrustTitle);
    expect(screen.queryByText(en.welcomeSkip)).toBeNull();
    expect(screen.getByText(en.welcomeBegin)).toBeTruthy();
  });

  it("the sample finding rotates on a slow timer", async () => {
    // fake timers first (every async helper hangs under them): fireEvent
    // is sync and safe, advancing runs inside act, reads stay sync.
    // All three samples share one stacked slot: assert visibility, the
    // box itself never resizes so nothing below ever moves.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const advance = (ms: number) => {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    };
    const slots = () => document.querySelectorAll(".welcome-sample > div");
    const visibleTitle = () =>
      document.querySelector(".welcome-sample > div.sample-on")!.textContent ?? "";
    try {
      open();
      expect(screen.getByText(en.welcomeFindsLabel)).toBeTruthy();
      fireEvent.click(screen.getByText(en.welcomeNextBtn));
      expect(screen.getByText(en.welcomeStepsTitle)).toBeTruthy();
      expect(slots()).toHaveLength(3);
      // first sample: disk
      expect(slots()[0].classList.contains("sample-on")).toBe(true);
      expect(visibleTitle()).toContain(en.diagnoses.disk_wait.title);
      // one interval: cpu takes the slot, disk hides (stays mounted)
      advance(4000);
      expect(slots()[1].classList.contains("sample-on")).toBe(true);
      expect(slots()[0].classList.contains("sample-off")).toBe(true);
      expect(visibleTitle()).toContain(en.diagnoses.cpu_busy.title);
      // cycles back around: gpu, then disk again
      advance(4000);
      expect(visibleTitle()).toContain(en.diagnoses.gpu_busy.title);
      advance(4000);
      expect(visibleTitle()).toContain(en.diagnoses.disk_wait.title);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reduced motion freezes the sample on the first finding", async () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      open();
      expect(screen.getByText(en.welcomeFindsLabel)).toBeTruthy();
      fireEvent.click(screen.getByText(en.welcomeNextBtn));
      expect(screen.getByText(en.welcomeStepsTitle)).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(12000);
      });
      // still disk: no timer was ever armed
      const frozen = document.querySelectorAll(".welcome-sample > div");
      expect(frozen[0].classList.contains("sample-on")).toBe(true);
      expect(frozen[1].classList.contains("sample-off")).toBe(true);
    } finally {
      vi.useRealTimers();
      window.matchMedia = matchMedia;
    }
  });
});
