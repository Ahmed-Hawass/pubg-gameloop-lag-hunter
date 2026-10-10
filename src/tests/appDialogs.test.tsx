// tests/appDialogs.test.tsx — the shell's two pushed-dialog contracts:
// a GameLoop death mid-session explains itself exactly once (never for
// manual stops), and the X button names in-flight work instead of
// silently dropping it.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  endProcesses: vi.fn(),
  processIcons: vi.fn(),
  systemChecks: vi.fn(),
  sessionEntries: vi.fn(),
  setAutoStop: vi.fn(),
  setSidebarCollapsed: vi.fn(),
  setTheme: vi.fn(),
  clockHour12: vi.fn(),
  dismissIntroCard: vi.fn(),
  setUiZoom: vi.fn(),
}));

const setWebviewZoomMock = vi.hoisted(() => vi.fn());

// native zoom applies through the WebView (always resolves in tests)
setWebviewZoomMock.mockResolvedValue(undefined);

let enginePush!: (ev: { payload: StatusPayload }) => void;

vi.mock("../bridge", () => ({
  api: apiMock,
  setWebviewZoom: setWebviewZoomMock,
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

// 24-hour default file-wide (mounted views read the OS convention)
apiMock.clockHour12.mockResolvedValue(false);
// intro cards read the dismissal list on mount (always-mounted views)
apiMock.getSettings.mockResolvedValue(settings());

import { closeWindow } from "../bridge";

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

function boot(state: StatusPayload) {
  apiMock.getState.mockResolvedValue(state);
  apiMock.getSettings.mockResolvedValue(settings());
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
  render(React.createElement(App));
}

describe("App pushed dialogs", () => {
  it("a GameLoop death explains itself exactly once", async () => {
    boot({ status: "idle", ui: null });
    await screen.findByText(en.scanIdleStart);
    const finished: StatusPayload = {
      status: "finished",
      ui: { ...idleUi, session: "session-1" },
      stop_reason: "gameloop_closed",
    };
    enginePush({ payload: finished });
    await screen.findByText(en.dialog.gameloopClosed);
    // a duplicate push (reconnect storm) must not re-raise it
    enginePush({ payload: finished });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getAllByText(en.dialog.gameloopClosed)).toHaveLength(1);
  });

  it("X during a running scan confirms with the scan named", async () => {
    const user = userEvent.setup();
    boot({
      status: "running",
      ui: { ...idleUi, session: "session-1", samples_count: 10 },
    });
    await screen.findByText(en.scanStop);
    await user.click(screen.getByLabelText(en.close));
    await screen.findByText(en.dialog.exitTitle);
    expect(screen.getByText(en.dialog.exitBodyScan)).toBeTruthy();
    // confirming rides the normal close path (the backend safety net runs)
    await user.click(screen.getByText(en.dialog.exitConfirm));
    expect(closeWindow).toHaveBeenCalledOnce();
  });

  it("zoom shortcuts step and reset through one state", async () => {
    boot({ status: "idle", ui: null });
    await screen.findByText(en.scanIdleStart);
    // persisted 100%: Ctrl+= steps the ladder (browser convention)
    apiMock.setUiZoom.mockResolvedValue(125);
    fireEvent.keyDown(document, { key: "=", ctrlKey: true });
    await waitFor(() => {
      expect(apiMock.setUiZoom).toHaveBeenCalledWith(125);
    });
    expect(setWebviewZoomMock).toHaveBeenCalledWith(1.25);
    // Ctrl+0 resets straight to 100%
    apiMock.setUiZoom.mockResolvedValue(100);
    fireEvent.keyDown(document, { key: "0", ctrlKey: true });
    await waitFor(() => {
      expect(apiMock.setUiZoom).toHaveBeenCalledWith(100);
    });
  });
});
