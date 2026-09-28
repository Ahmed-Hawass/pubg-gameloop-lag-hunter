// tests/appAdvice.test.tsx — the once-ever advice contracts: the
// pre-scan tip fires on the first real session start, the stay-in-game
// tip only on a visible-to-background transition (never on the starting
// state), and finishing welcome persists onboarding and raises the
// first-run advice.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import App from "../App";
import type { StatusPayload, UiState } from "../bridge";
import { settings, systemInfo } from "./fixtures";

const apiMock = vi.hoisted(() => ({
  getState: vi.fn(),
  getSettings: vi.fn(),
  psAvailable: vi.fn(),
  getVersion: vi.fn(),
  watchGameloop: vi.fn(),
  checkUpdate: vi.fn(),
  updateAlreadyAnnounced: vi.fn(),
  announceUpdate: vi.fn(),
  systemInfo: vi.fn(),
  topProcesses: vi.fn(),
  systemChecks: vi.fn(),
  sessionEntries: vi.fn(),
  setAutoStop: vi.fn(),
  setSidebarCollapsed: vi.fn(),
  setTheme: vi.fn(),
  setLanguage: vi.fn(),
  finishOnboarding: vi.fn(),
  finishGameAdvice: vi.fn(),
  finishBackgroundAdvice: vi.fn(),
}));

let enginePush!: (ev: { payload: StatusPayload }) => void;

vi.mock("../bridge", () => ({
  api: apiMock,
  closeWindow: vi.fn(),
  onEngineState: vi.fn((cb: (ev: { payload: StatusPayload }) => void) => {
    enginePush = cb;
    return Promise.resolve(() => {});
  }),
  isWindowMaximized: vi.fn().mockResolvedValue(false),
  minimizeWindow: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
  onWindowResized: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
  LanguageProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

const idleUi: UiState = {
  v: 1,
  session: null,
  started_at: null,
  time: "00:00",
  game_running: false,
  game_visible: null,
  overall: "ok",
  lag_count: 0,
  bars: { cpu: 0, ram: 0, gpu: null, disk: 0 },
  history: { cpu: [], ram: [], gpu: [], disk: [] },
  spikes: [],
  elapsed_sec: 0,
  auto_stop_sec: null,
  feed: [],
  diagnoses: [],
  samples_count: 0,
  emulator: null,
};

function boot(options: { advice?: "game" | "background" | "done"; onboarding?: boolean }) {
  const { advice = "done", onboarding = true } = options;
  apiMock.getState.mockResolvedValue({ status: "idle", ui: null });
  apiMock.getSettings.mockResolvedValue(
    settings({
      onboarding_done: onboarding,
      game_advice_done: advice !== "game",
      background_advice_done: advice !== "background",
    }),
  );
  apiMock.psAvailable.mockResolvedValue(true);
  apiMock.getVersion.mockResolvedValue("1.6.0");
  apiMock.watchGameloop.mockResolvedValue(undefined);
  apiMock.checkUpdate.mockResolvedValue(null);
  apiMock.systemInfo.mockResolvedValue(systemInfo());
  apiMock.topProcesses.mockResolvedValue({ processes: [], total_cpu: 0, total_ram_mb: 0 });
  apiMock.systemChecks.mockResolvedValue({
    power: "ok",
    pagefile: "ok",
    charger: "ok",
    vt: "ok",
    dvr: "ok",
  });
  apiMock.sessionEntries.mockResolvedValue([]);
  apiMock.finishGameAdvice.mockResolvedValue(undefined);
  apiMock.finishBackgroundAdvice.mockResolvedValue(undefined);
  apiMock.finishOnboarding.mockResolvedValue(undefined);
  render(React.createElement(App));
}

const running = (ui: Partial<UiState>): StatusPayload => ({
  status: "running",
  ui: { ...idleUi, ...ui },
});

describe("App one-shot advice", () => {
  it("pre-scan tip fires on the first real start and persists at show", async () => {
    boot({ advice: "game" });
    await screen.findByText(en.startScanning);
    enginePush({ payload: running({ session: "s-1" }) });
    await screen.findByText(en.dialog.gameAdviceTitle);
    // persisted at SHOW, not at close: already recorded while open
    expect(apiMock.finishGameAdvice).toHaveBeenCalledOnce();
  });

  it("stay-in-game tip needs a visible-to-background transition", async () => {
    boot({ advice: "background" });
    await screen.findByText(en.startScanning);
    const tick = () => new Promise((r) => setTimeout(r, 0));
    // starting minimized is expected, not nag-worthy: no dialog
    enginePush({ payload: running({ session: "s-1", game_visible: false }) });
    await tick();
    expect(screen.queryByText(en.dialog.backgroundAdviceTitle)).toBeNull();
    // the transition fires it once and persists it (pushes land on
    // separate ticks in production, so flush effects between them here)
    enginePush({ payload: running({ session: "s-1", game_visible: true }) });
    await tick();
    enginePush({ payload: running({ session: "s-1", game_visible: false }) });
    await screen.findByText(en.dialog.backgroundAdviceTitle);
    expect(apiMock.finishBackgroundAdvice).toHaveBeenCalledOnce();
  });

  it("finishing welcome persists onboarding and raises first-run advice", async () => {
    const user = userEvent.setup();
    boot({ onboarding: false });
    await screen.findByText(en.welcomeTitle);
    // three slides: identity, how-it-works, cost — Begin lives on the last
    await user.click(screen.getByText(en.welcomeNextBtn));
    await screen.findByText(en.welcomeStepsTitle);
    await user.click(screen.getByText(en.welcomeNextBtn));
    await screen.findByText(en.welcomeTrustTitle);
    await user.click(screen.getByText(en.welcomeBegin));
    await waitFor(() => {
      expect(apiMock.finishOnboarding).toHaveBeenCalledOnce();
    });
    await screen.findByText(en.dialog.firstRunAdvice);
  });
});
