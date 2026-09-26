// tests/monitor.test.tsx — the Monitor contract: Start/Stop wiring,
// duration pills, the finished summary with its report shortcut, and the
// 12s auto-dismiss that once lived forever across tab switches.

import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { MonitorView } from "../views/MonitorView";
import type { StatusPayload, UiState } from "../bridge";

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

describe("MonitorView", () => {
  it("idle offers Start and duration pills plus guidance, never a dead feed", async () => {
    const user = userEvent.setup();
    const { onToggle, onDurationChange } = open({ status: "idle", ui: null });
    await user.click(screen.getByText(en.startScanning));
    expect(onToggle).toHaveBeenCalledOnce();
    await user.click(screen.getByText(en.min10));
    expect(onDurationChange).toHaveBeenCalledWith(600);
    // the calm state explains itself instead of an empty gap
    expect(screen.getByText(en.idleGuideTitle)).toBeTruthy();
    // no streaming section while stopped (guidance above says it all)
    expect(screen.queryByText(en.activity)).toBeNull();
  });

  it("a busy Start is dead (no stacked sessions)", async () => {
    const user = userEvent.setup();
    const { onToggle } = open(
      { status: "idle", ui: null },
      { busy: true },
    );
    await user.click(screen.getByText(en.startScanning));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("running locks the pills and offers Stop", async () => {
    const user = userEvent.setup();
    const { onToggle } = open({ status: "running", ui });
    await user.click(screen.getByText(en.stop));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(screen.getByText(en.min10).closest("button")).toBeDisabled();
  });

  it("finished summary opens the report or dismisses it", async () => {
    const user = userEvent.setup();
    const { onOpenReport, onDismissSummary } = open({ status: "finished", ui });
    expect(screen.getByText(en.spikesCaptured(2))).toBeTruthy();
    await user.click(screen.getByText(en.openReportBtn));
    expect(onOpenReport).toHaveBeenCalledOnce();
    await user.click(document.querySelector(".summary-x")!);
    expect(onDismissSummary).toHaveBeenCalledWith("session-9");
  });

  it("a dismissed summary never resurrects", () => {
    open({ status: "finished", ui }, { dismissedSession: "session-9" });
    expect(screen.queryByText(en.spikesCaptured(2))).toBeNull();
  });

  it("the summary auto-dismisses after 12s", () => {
    vi.useFakeTimers();
    try {
      const { onDismissSummary } = open({ status: "finished", ui });
      expect(onDismissSummary).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(12_000);
      });
      expect(onDismissSummary).toHaveBeenCalledWith("session-9");
    } finally {
      vi.useRealTimers();
    }
  });

  it("diagnoses outrank the feed and the log collapses on demand", async () => {
    const user = userEvent.setup();
    const live: UiState = {
      ...ui,
      feed: [{ phase: "instant", clock: "00:01", kind: "spike", sev: "crit" }],
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
    open({ status: "running", ui: live });
    // translated card above the raw log in DOM order
    const card = await screen.findByText(en.diagnoses.cpu_busy.title);    const logToggle = screen.getByText(en.hideEventLog);
    expect(
      card.compareDocumentPosition(logToggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText("backend title")).toBeNull();
    // collapsing hides rows, expanding restores them
    await user.click(logToggle);
    expect(screen.queryByText(en.feed.spike)).toBeNull();
    await user.click(screen.getByText(en.showEventLog));
    expect(screen.getByText(en.feed.spike)).toBeTruthy();
  });

  it("the timeline reads elapsed over target", async () => {
    open({ status: "running", ui });
    // 65s elapsed of a 300s auto-stop: "01:05 / 05:00"
    expect(await screen.findByText("01:05 / 05:00")).toBeTruthy();
  });
});
