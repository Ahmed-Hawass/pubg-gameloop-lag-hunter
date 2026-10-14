// tray.test.ts — the tray's two decisions, as tests.
// The native surface is Rust's (tray.rs); this pins the frontend-owned part:
// WHEN the tooltip changes, and whether Quick scan starts or only shows.

import { describe, expect, it } from "vitest";
import {
  hasLiveResult,
  quickScanIntent,
  scanPercent,
  trayPercentToPush,
  TOOLTIP_STEP_PCT,
} from "../tray";
import type { StatusPayload, UiState } from "../bridge";

function ui(over: Partial<UiState> = {}): UiState {
  return {
    v: 1,
    session: "session-1",
    started_at: null,
    time: "00:00",
    game_running: true,
    game_visible: true,
    overall: "ok",
    lag_count: 0,
    bars: { cpu: 0, ram: 0, gpu: null, disk: 0 },
    history: { cpu: [], ram: [], gpu: [], disk: [] },
    spikes: [],
    elapsed_sec: 0,
    auto_stop_sec: 300,
    feed: [],
    diagnoses: [],
    samples_count: 10,
    emulator: null,
    ...over,
  };
}

describe("trayPercentToPush", () => {
  it("returns 0 when not scanning (the tooltip falls back to its idle wording)", () => {
    expect(trayPercentToPush({ status: "idle", ui: null }, null)).toBe(0);
    expect(trayPercentToPush({ status: "finished", ui: ui() }, null)).toBe(0);
    expect(trayPercentToPush({ status: "stopping", ui: ui() }, null)).toBe(0);
  });

  it("returns 0 when the session carries no stop plan", () => {
    expect(
      trayPercentToPush({ status: "running", ui: ui({ auto_stop_sec: null }) }, null),
    ).toBe(0);
    expect(
      trayPercentToPush({ status: "running", ui: ui({ auto_stop_sec: 0 }) }, null),
    ).toBe(0);
  });

  it("pushes the first percent without throttling", () => {
    const payload: StatusPayload = { status: "running", ui: ui({ elapsed_sec: 15, auto_stop_sec: 300 }) };
    expect(trayPercentToPush(payload, null)).toBe(5);
  });

  it("stays quiet while the percent barely moves (an IPC push per tick is a flood)", () => {
    expect(TOOLTIP_STEP_PCT).toBe(5);
    const a: StatusPayload = { status: "running", ui: ui({ elapsed_sec: 15, auto_stop_sec: 300 }) };
    const b: StatusPayload = { status: "running", ui: ui({ elapsed_sec: 21, auto_stop_sec: 300 }) };
    expect(trayPercentToPush(a, null)).toBe(5);
    expect(trayPercentToPush(b, 5)).toBeNull();
  });

  it("pushes again once a full step passed", () => {
    const payload: StatusPayload = { status: "running", ui: ui({ elapsed_sec: 30, auto_stop_sec: 300 }) };
    expect(trayPercentToPush(payload, 5)).toBe(10);
  });

  it("always pushes 100 (a scan finished at 99 must not look unfinished)", () => {
    const payload: StatusPayload = { status: "running", ui: ui({ elapsed_sec: 300, auto_stop_sec: 300 }) };
    expect(trayPercentToPush(payload, 99)).toBe(100);
  });

  it("clamps past-the-end elapsed to 100", () => {
    const payload: StatusPayload = { status: "running", ui: ui({ elapsed_sec: 999, auto_stop_sec: 300 }) };
    expect(trayPercentToPush(payload, null)).toBe(100);
  });
});

describe("quickScanIntent", () => {
  it("stops while a scan is running (the item reads Stop then)", () => {
    expect(quickScanIntent({ status: "running", ui: null })).toBe("stop");
  });

  it("only shows the window while a scan is winding down", () => {
    expect(quickScanIntent({ status: "stopping", ui: null })).toBe("show");
  });

  it("starts over an unread verdict (an explicit press means a new scan)", () => {
    // the old verdict stays saved in Reports; the new run replaces the card
    const payload: StatusPayload = { status: "finished", ui: ui({ samples_count: 10 }) };
    expect(quickScanIntent(payload)).toBe("start");
  });

  it("starts on idle and on empty finishes (nothing running)", () => {
    expect(quickScanIntent({ status: "idle", ui: null })).toBe("start");
    const empty: StatusPayload = { status: "finished", ui: ui({ samples_count: 0 }) };
    expect(quickScanIntent(empty)).toBe("start");
    const noSession: StatusPayload = { status: "finished", ui: ui({ session: null }) };
    expect(quickScanIntent(noSession)).toBe("start");
  });
});

describe("scanPercent", () => {
  it("reads elapsed over auto-stop while measuring, clamped 0 to 100", () => {
    expect(scanPercent({ status: "running", ui: ui({ elapsed_sec: 150, auto_stop_sec: 300 }) })).toBe(
      50,
    );
    expect(scanPercent({ status: "stopping", ui: ui({ elapsed_sec: 150, auto_stop_sec: 300 }) })).toBe(
      50,
    );
    expect(scanPercent({ status: "running", ui: ui({ elapsed_sec: 999, auto_stop_sec: 300 }) })).toBe(
      100,
    );
  });

  it("is null whenever nothing is measuring", () => {
    expect(scanPercent({ status: "idle", ui: null })).toBeNull();
    expect(scanPercent({ status: "finished", ui: ui() })).toBeNull();
    expect(scanPercent({ status: "running", ui: null })).toBeNull();
    expect(scanPercent({ status: "running", ui: ui({ auto_stop_sec: null }) })).toBeNull();
    expect(scanPercent({ status: "running", ui: ui({ auto_stop_sec: 0 }) })).toBeNull();
  });
});

describe("hasLiveResult", () => {
  it("is true for an unread verdict with samples", () => {
    expect(hasLiveResult({ status: "finished", ui: ui({ samples_count: 10 }) }, null)).toBe(true);
  });

  it("is false once dismissed, empty, session-less, or not finished", () => {
    const done: StatusPayload = {
      status: "finished",
      ui: ui({ session: "session-1", samples_count: 10 }),
    };
    expect(hasLiveResult(done, "session-1")).toBe(false);
    expect(hasLiveResult({ status: "finished", ui: ui({ samples_count: 0 }) }, null)).toBe(false);
    expect(hasLiveResult({ status: "finished", ui: ui({ session: null }) }, null)).toBe(false);
    expect(hasLiveResult({ status: "running", ui: ui() }, null)).toBe(false);
    expect(hasLiveResult({ status: "idle", ui: null }, null)).toBe(false);
  });
});
