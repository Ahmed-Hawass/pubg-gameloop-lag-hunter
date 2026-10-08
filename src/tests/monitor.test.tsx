// tests/monitor.test.tsx — the Monitor contract across its three states.
// The page answers a different question per phase of a scan, so each state
// is pinned separately: the decision screen, the away screen, and the verdict.
//
// The old suite pinned a live instrument panel (tiles, timeline, feed).
// Those measured the whole machine rather than the game, so they sat red
// during normal play and taught the user to ignore red. They are gone, and
// so are the tests that pinned them.

import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { MonitorView } from "../views/MonitorView";
import type { StatusPayload, UiState } from "../bridge";

const apiMock = vi.hoisted(() => ({
  clockHour12: vi.fn(),
}));

vi.mock("../bridge", () => ({
  api: apiMock,
}));

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
}));

const ui: UiState = {
  v: 1,
  session: "session-9",
  started_at: null,
  time: "00:00",
  game_running: true,
  game_visible: true,
  overall: "lag",
  lag_count: 2,
  bars: { cpu: 90, ram: 70, gpu: 40, disk: 30 },
  history: { cpu: [10, 90], ram: [10, 70], gpu: [10, 40], disk: [10, 30] },
  spikes: [],
  elapsed_sec: 65,
  auto_stop_sec: 300,
  feed: [],
  diagnoses: [],
  samples_count: 65,
  emulator: "AndroidEmulatorEn",
};

function open(status: StatusPayload, over: Partial<React.ComponentProps<typeof MonitorView>> = {}) {
  const onToggle = vi.fn();
  const onDurationChange = vi.fn();
  const onOpenReport = vi.fn();
  const onDismissSummary = vi.fn();
  render(
    React.createElement(MonitorView, {
      status,
      busy: false,
      durationSecs: 300,
      onDurationChange,
      onToggle,
      onOpenReport,
      dismissedSession: null,
      onDismissSummary,
      psLimited: false,
      ...over,
    }),
  );
  return { onToggle, onDurationChange, onOpenReport, onDismissSummary };
}

describe("MonitorView — idle state", () => {
  it("offers Start and the duration pills, and explains itself", async () => {
    const user = userEvent.setup();
    const { onToggle, onDurationChange } = open({ status: "idle", ui: null });
    await user.click(screen.getByText(en.scanIdleStart));
    expect(onToggle).toHaveBeenCalledOnce();
    await user.click(screen.getByText(en.min10));
    expect(onDurationChange).toHaveBeenCalledWith(600);
    // the plan leads with the session itself: kicker, big number, pills.
    // The helper opens with durationSecs 300, so the big number reads 5.
    expect(screen.getByText(en.scanPlanKicker)).toBeTruthy();
    // "5" also names a pill, so the big number is read off its own node
    expect(document.querySelector(".plan-big .num")?.textContent).toBe("5");
    expect(screen.getByText(en.scanPlanUnit(5))).toBeTruthy();
    // the 3-step path teaches the flow in one glance
    expect(screen.getByText(en.scanStep1)).toBeTruthy();
    expect(screen.getByText(en.scanStep2)).toBeTruthy();
    expect(screen.getByText(en.scanStep3)).toBeTruthy();
    // one quiet footnote, not a panel: the close-apps tip. (The minimize
    // reassurance lives in the running state now, where the doubt is live.)
    expect(screen.getByText(en.scanIdleCloseApps)).toBeTruthy();
  });

  it("the 3-step path stays readable to assistive tech", async () => {
    open({ status: "idle", ui: null });
    // the steps container must not hide itself: only the number discs
    // are decorative, the step sentences stay exposed
    const step = screen.getByText(en.scanStep1).closest(".plan-steps")!;
    expect(step.getAttribute("aria-hidden")).toBeNull();
    expect(screen.getByText(en.scanStep2).closest(".step")).toBeTruthy();
  });

  it("a busy Start is dead (no stacked sessions)", async () => {
    const user = userEvent.setup();
    const { onToggle } = open({ status: "idle", ui: null }, { busy: true });
    await user.click(screen.getByText(en.scanIdleStart));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("a busy Start dims until the action lands", () => {
    open({ status: "idle", ui: null }, { busy: true });
    const btn = screen.getByText(en.scanIdleStart).closest("button")!;
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.className).toContain("is-disabled");
  });

  it("running locks the pills and offers Stop", async () => {
    const user = userEvent.setup();
    const { onToggle } = open({ status: "running", ui });
    await user.click(screen.getByText(en.scanStop));
    expect(onToggle).toHaveBeenCalledOnce();
    // the duration pills are not rendered while running: the decision was
    // made before the scan started, and the running screen has no controls
    // beyond Stop
    expect(screen.queryByText(en.min10)).toBeNull();
  });
});

describe("MonitorView — running state", () => {
  it("sends the user back to the game and shows the clock", () => {
    open({ status: "running", ui });
    expect(screen.getByText(en.scanRunningTitle)).toBeTruthy();
    expect(screen.getByText(en.scanRunningBody)).toBeTruthy();
    // the minimize reassurance lives here, where the window is actually
    // open — idle can only promise it in theory
    expect(screen.getByText(en.scanRunningNote)).toBeTruthy();
    // the two numbers the returning user actually wants
    expect(screen.getByText("01:05")).toBeTruthy();
    // 65s elapsed of a 300s auto-stop: 235s left, ceil to 4 min
    expect(screen.getByText(en.scanRemaining(4))).toBeTruthy();
  });

  it("shows the moment count only once something was captured", () => {
    open({ status: "running", ui });
    expect(screen.queryByText(en.scanMoments(0))).toBeNull();
    const withMoments: UiState = {
      ...ui,
      diagnoses: [
        {
          key: "cpu_busy",
          title: "backend title",
          simple: "backend simple",
          cause: "backend cause",
          fix: "backend fix",
          severity: "high",
          at: "00:01",
        },
      ],
    };
    open({ status: "running", ui: withMoments });
    expect(screen.getByText(en.scanMoments(1))).toBeTruthy();
  });

  it("has no live instrument panel: no tiles, no timeline, no feed", () => {
    open({ status: "running", ui });
    // the tiles measured the machine, not the game, and misled during play.
    // Asserted on the DOM, not on locale keys: the point is that no metric
    // surface renders at all while the user is away.
    expect(document.querySelector(".metric")).toBeNull();
    expect(document.querySelector(".timeline")).toBeNull();
    expect(document.querySelector(".feed")).toBeNull();
    // the feed is trimmed to a 5 minute window by the engine, so it came back
    // incomplete on a long scan; the count cannot lie about the past
    expect(screen.queryByText(en.scanRunningTitle)).toBeTruthy();
  });
});

describe("MonitorView — result state", () => {
  it("states the verdict and opens the report", async () => {
    const user = userEvent.setup();
    const { onOpenReport } = open({ status: "finished", ui });
    expect(screen.getByText(en.scanResultLagTitle)).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    await user.click(screen.getByText(en.scanResultOpenReport));
    expect(onOpenReport).toHaveBeenCalledOnce();
  });

  it("reads clean when nothing was captured", () => {
    const clean: UiState = { ...ui, lag_count: 0, diagnoses: [], spikes: [] };
    open({ status: "finished", ui: clean });
    expect(screen.getByText(en.scanResultCleanTitle)).toBeTruthy();
    // the verdict number, not the moment count (both read 0 when clean)
    expect(document.querySelector(".verdict-num .num")?.textContent).toBe("0");
  });

  it("never auto-dismisses: a user returning from a long scan still finds it", () => {
    vi.useFakeTimers();
    try {
      const { onDismissSummary } = open({ status: "finished", ui });
      expect(onDismissSummary).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      // the old 12s TTL meant the verdict was gone before the user came back
      expect(onDismissSummary).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a dismissed verdict never resurrects", () => {
    open({ status: "finished", ui }, { dismissedSession: "session-9" });
    expect(screen.queryByText(en.scanResultLagTitle)).toBeNull();
  });

  it("Scan again is the dismiss path", async () => {
    const user = userEvent.setup();
    const { onDismissSummary } = open({ status: "finished", ui });
    await user.click(screen.getByText(en.scanResultAgain));
    expect(onDismissSummary).toHaveBeenCalledWith("session-9");
  });
});