// tests/appDialogs.test.tsx - the shell's two pushed-dialog contracts:
// a GameLoop death mid-session explains itself exactly once (never for
// manual stops), X hides to the tray without quitting, and the tray Exit
// names in-flight work instead of silently dropping it.

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import App from "../App";
import type { StatusPayload, UiState } from "../bridge";
import { settings, systemInfo } from "./fixtures";

const apiMock = vi.hoisted(() => ({
  getState: vi.fn(),
  getSettings: vi.fn(),
  gameLoopInstallationStatus: vi.fn(),
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
  sessionStart: vi.fn(),
  sessionStop: vi.fn(),
  startupEntries: vi.fn().mockResolvedValue([]),
  setStartupEnabled: vi.fn(),
}));

const setWebviewZoomMock = vi.hoisted(() => vi.fn());

// native zoom applies through the WebView (always resolves in tests)
setWebviewZoomMock.mockResolvedValue(undefined);

let enginePush!: (ev: { payload: StatusPayload }) => void;
let trayExitPush!: () => void;
let trayQuickPush!: () => void;

vi.mock("../bridge", () => ({
  api: apiMock,
  setWebviewZoom: setWebviewZoomMock,
  quitApp: vi.fn().mockResolvedValue(undefined),
  hideWindow: vi.fn().mockResolvedValue(undefined),
  revealWindow: vi.fn().mockResolvedValue(undefined),
  setTrayActive: vi.fn().mockResolvedValue(undefined),
  logFrontendInfo: vi.fn().mockResolvedValue(undefined),
  logFrontendError: vi.fn().mockResolvedValue(undefined),
  onEngineState: vi.fn((cb: (ev: { payload: StatusPayload }) => void) => {
    enginePush = cb;
    return Promise.resolve(() => {});
  }),
  isWindowMaximized: vi.fn().mockResolvedValue(false),
  minimizeWindow: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
  onWindowResized: vi.fn().mockResolvedValue(() => {}),
  syncSnapOverlay: vi.fn().mockResolvedValue(undefined),
  onSnapOverlay: vi.fn().mockResolvedValue(() => {}),
  syncTrayLabels: vi.fn().mockResolvedValue(undefined),
  setTrayTooltip: vi.fn().mockResolvedValue(undefined),
  onTrayQuickScan: vi.fn((cb: () => void) => {
    trayQuickPush = cb;
    return Promise.resolve(() => {});
  }),
  onTrayExit: vi.fn((cb: () => void) => {
    trayExitPush = cb;
    return Promise.resolve(() => {});
  }),
  isWindowVisible: vi.fn().mockResolvedValue(true),
  showMainWindow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
  LanguageProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

// 24-hour default file-wide (mounted views read the OS convention)
apiMock.clockHour12.mockResolvedValue(false);
apiMock.gameLoopInstallationStatus.mockResolvedValue("installed");
// intro cards read the dismissal list on mount (always-mounted views)
apiMock.getSettings.mockResolvedValue(settings());

import {
  hideWindow,
  quitApp,
  revealWindow,
  setTrayActive,
  setTrayTooltip,
  syncTrayLabels,
} from "../bridge";

const idleUi: UiState = {
  v: 1,
  session: null,
  started_at: null,
  time: "00:00",
  game_running: false,
  game_visible: null,
  overall: "ok",
  lag_count: 0,
  issue_kinds: 0,
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

/** Let the boot state's passive effects flush (status/toggle mirrors the
    tray handler reads) before firing a captured tray event: under full-suite
    load the findByText resolve alone does not guarantee settled refs. */
async function settleTrayRefs(): Promise<void> {
  await act(async () => {});
}

function boot(state: StatusPayload) {
  apiMock.getState.mockResolvedValue(state);
  apiMock.getSettings.mockResolvedValue(settings());
  apiMock.psAvailable.mockResolvedValue(true);
  apiMock.getVersion.mockResolvedValue("1.6.0");
  apiMock.watchGameloop.mockResolvedValue(undefined);
  apiMock.checkUpdate.mockResolvedValue(null);
  apiMock.systemInfo.mockResolvedValue(systemInfo());
  apiMock.topProcesses.mockResolvedValue({ processes: [] });
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

  it("stopping mid-startup is quiet success, never an error dialog", async () => {
    const user = userEvent.setup();
    boot({ status: "idle", ui: null });
    await screen.findByText(en.scanIdleStart);
    apiMock.sessionStart.mockRejectedValue("SESSION_STOPPED_DURING_START");
    apiMock.getState.mockResolvedValue({ status: "idle", ui: null });
    await user.click(screen.getByText(en.scanIdleStart));
    await waitFor(() => {
      expect(apiMock.getState).toHaveBeenCalled();
    });
    await new Promise((r) => setTimeout(r, 50));
    // the stop already won: no dialog, no technical line, just the idle page
    expect(screen.queryByText(en.dialog.somethingWrong)).toBeNull();
    expect(await screen.findByText(en.scanIdleStart)).toBeTruthy();
  });

  it("X hides to the tray instead of quitting (even mid-scan)", async () => {
    const user = userEvent.setup();
    boot({
      status: "running",
      ui: { ...idleUi, session: "session-1", samples_count: 10 },
    });
    await screen.findByText(en.scanStop);
    vi.mocked(hideWindow).mockClear();
    await user.click(screen.getByLabelText(en.hideToTray));
    expect(hideWindow).toHaveBeenCalledOnce();
    // no exit confirm: hiding is non-destructive, the scan keeps measuring
    expect(screen.queryByText(en.dialog.exitTitle)).toBeNull();
  });

  it("tray Exit during a running scan reveals first and confirms with the scan named", async () => {
    const user = userEvent.setup();
    boot({
      status: "running",
      ui: { ...idleUi, session: "session-1", samples_count: 10 },
    });
    await screen.findByText(en.scanStop);
    vi.mocked(revealWindow).mockClear();
    await settleTrayRefs();
    act(() => trayExitPush());
    await screen.findByText(en.dialog.exitTitle);
    // the confirm lives in the window, so the hidden window comes back first
    expect(revealWindow).toHaveBeenCalledOnce();
    expect(screen.getByText(en.dialog.exitBodyScan)).toBeTruthy();
    // confirming rides the normal quit path (the backend safety net runs)
    await user.click(screen.getByText(en.dialog.exitConfirm));
    expect(quitApp).toHaveBeenCalled();
  });

  it("Alt+F4 quits silently when idle (never hides)", async () => {
    boot({ status: "idle", ui: null });
    await screen.findByText(en.scanIdleStart);
    vi.mocked(quitApp).mockClear();
    vi.mocked(revealWindow).mockClear();
    await settleTrayRefs();
    fireEvent.keyDown(document, { key: "F4", altKey: true });
    await waitFor(() => {
      expect(quitApp).toHaveBeenCalledOnce();
    });
    expect(revealWindow).not.toHaveBeenCalled();
    expect(screen.queryByText(en.dialog.exitTitle)).toBeNull();
  });

  it("Alt+F4 confirms over a running scan like tray Exit does", async () => {
    boot({
      status: "running",
      ui: { ...idleUi, session: "session-1", samples_count: 10 },
    });
    await screen.findByText(en.scanStop);
    await settleTrayRefs();
    fireEvent.keyDown(document, { key: "F4", altKey: true });
    await screen.findByText(en.dialog.exitTitle);
    expect(screen.getByText(en.dialog.exitBodyScan)).toBeTruthy();
  });

  it("tray Exit when idle quits silently without flashing the window", async () => {
    boot({ status: "idle", ui: null });
    await screen.findByText(en.scanIdleStart);
    vi.mocked(quitApp).mockClear();
    vi.mocked(revealWindow).mockClear();
    await settleTrayRefs();
    act(() => trayExitPush());
    await waitFor(() => {
      expect(quitApp).toHaveBeenCalledOnce();
    });
    expect(revealWindow).not.toHaveBeenCalled();
    expect(screen.queryByText(en.dialog.exitTitle)).toBeNull();
  });

  it("tray Quick scan starts silently while hidden on success", async () => {
    boot({ status: "idle", ui: null });
    await screen.findByText(en.scanIdleStart);
    apiMock.sessionStart.mockResolvedValue({
      status: "running",
      ui: { ...idleUi, session: "session-9", samples_count: 0 },
    });
    vi.mocked(revealWindow).mockClear();
    await settleTrayRefs();
    act(() => trayQuickPush());
    await waitFor(() => {
      expect(apiMock.sessionStart).toHaveBeenCalled();
    });
    await new Promise((r) => setTimeout(r, 50));
    // clean start: no window flash, the tooltip carries the live percent
    expect(revealWindow).not.toHaveBeenCalled();
    expect(screen.queryByText(en.dialog.somethingWrong)).toBeNull();
  });

  it("tray Quick scan reveals the window only when the start fails", async () => {
    boot({ status: "idle", ui: null });
    await screen.findByText(en.scanIdleStart);
    apiMock.sessionStart.mockRejectedValue("boom");
    vi.mocked(revealWindow).mockClear();
    await settleTrayRefs();
    act(() => trayQuickPush());
    await screen.findByText(en.dialog.somethingWrong);
    expect(revealWindow).toHaveBeenCalledOnce();
  });

  it("tray scan item stops a running scan silently while hidden", async () => {
    boot({
      status: "running",
      ui: { ...idleUi, session: "session-1", samples_count: 10 },
    });
    await screen.findByText(en.scanStop);
    apiMock.sessionStop.mockResolvedValue({ status: "stopping", ui: null });
    vi.mocked(revealWindow).mockClear();
    await settleTrayRefs();
    act(() => trayQuickPush());
    await waitFor(() => {
      expect(apiMock.sessionStop).toHaveBeenCalled();
    });
    await new Promise((r) => setTimeout(r, 50));
    // a stop needs no eyes: no flash, no dialog
    expect(revealWindow).not.toHaveBeenCalled();
    expect(screen.queryByText(en.dialog.exitTitle)).toBeNull();
  });

  it("tray scan item reads Stop with the live percent while running", async () => {
    vi.mocked(syncTrayLabels).mockClear();
    vi.mocked(setTrayActive).mockClear();
    boot({
      status: "running",
      ui: { ...idleUi, session: "session-1", samples_count: 10, elapsed_sec: 150, auto_stop_sec: 300 },
    });
    await screen.findByText(en.scanStop);
    // the boot state lands after the mount push: poll for the live labels
    await waitFor(() => {
      const labels = vi.mocked(syncTrayLabels).mock.calls.map((c) => c[0]);
      expect(labels[labels.length - 1]).toEqual({
        open: en.trayOpen,
        scan: en.trayStopScan(50),
        exit: en.trayExit,
      });
    });
    // the icon turns green while measuring
    await waitFor(() => {
      expect(setTrayActive).toHaveBeenCalledWith(true);
    });
  });

  it("tray Quick scan starts over an unread verdict instead of stalling on it", async () => {
    boot({
      status: "finished",
      ui: { ...idleUi, session: "session-1", samples_count: 10 },
    });
    await screen.findByText(en.scanResultOpenReport);
    apiMock.sessionStart.mockResolvedValue({
      status: "running",
      ui: { ...idleUi, session: "session-2", samples_count: 0 },
    });
    vi.mocked(revealWindow).mockClear();
    await settleTrayRefs();
    act(() => trayQuickPush());
    await waitFor(() => {
      expect(apiMock.sessionStart).toHaveBeenCalled();
    });
    await new Promise((r) => setTimeout(r, 50));
    // an explicit press means a new scan: no stall, no flash
    expect(revealWindow).not.toHaveBeenCalled();
  });

  it("tray tooltip names the done verdict while it waits unread", async () => {
    vi.mocked(setTrayTooltip).mockClear();
    vi.mocked(syncTrayLabels).mockClear();
    boot({
      status: "finished",
      ui: { ...idleUi, session: "session-7", samples_count: 12 },
    });
    // the boot state lands after the mount push: poll for the done wording
    await waitFor(() => {
      const texts = vi.mocked(setTrayTooltip).mock.calls.map((c) => c[0]);
      expect(texts).toContain(en.trayTooltipDone);
    });
    // finished is not scanning: the item reads Quick scan again
    await waitFor(() => {
      const labels = vi.mocked(syncTrayLabels).mock.calls.map((c) => c[0]);
      expect(labels[labels.length - 1]).toEqual({
        open: en.trayOpen,
        scan: en.trayQuickScan,
        exit: en.trayExit,
      });
    });
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
