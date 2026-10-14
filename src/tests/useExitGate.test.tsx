// tests/useExitGate.test.tsx — the tray Exit gate: quiet work quits
// straight away, a running scan or an active download/cleaning names
// itself in one confirm instead.

import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { APP_DIALOG_OPEN_EVENT } from "../components/components";
import { useExitGate } from "../useExitGate";
import type { StatusPayload } from "../bridge";

const quitAppMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const revealWindowMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../bridge", () => ({
  api: {},
  quitApp: quitAppMock,
  revealWindow: revealWindowMock,
  logFrontendInfo: vi.fn().mockResolvedValue(undefined),
}));

const idle: StatusPayload = { status: "idle", ui: null };
const running: StatusPayload = { status: "running", ui: null };

describe("useExitGate", () => {
  it("quits silently when nothing is in flight (no window flash)", () => {
    quitAppMock.mockClear();
    revealWindowMock.mockClear();
    revealWindowMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useExitGate(idle));
    act(() => result.current.requestExit());
    expect(quitAppMock).toHaveBeenCalledOnce();
    expect(revealWindowMock).not.toHaveBeenCalled();
    expect(result.current.exitConfirm).toBeNull();
  });

  it("reveals the window and names a running scan in one confirm instead", () => {
    quitAppMock.mockClear();
    revealWindowMock.mockClear();
    revealWindowMock.mockResolvedValue(undefined);
    const seen: string[] = [];
    const onEvent = () => seen.push("app-dialog");
    window.addEventListener(APP_DIALOG_OPEN_EVENT, onEvent);
    const { result } = renderHook(() => useExitGate(running));
    act(() => result.current.requestExit());
    expect(quitAppMock).not.toHaveBeenCalled();
    expect(revealWindowMock).toHaveBeenCalledOnce();
    expect(result.current.exitConfirm).toEqual({ scan: true, download: false, cleaning: false });
    expect(seen).toEqual(["app-dialog"]);
    window.removeEventListener(APP_DIALOG_OPEN_EVENT, onEvent);
  });

  it("names an active download reported by the modal", () => {
    quitAppMock.mockClear();
    revealWindowMock.mockClear();
    revealWindowMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useExitGate(idle));
    act(() => result.current.onDownloadActivity(true));
    act(() => result.current.requestExit());
    expect(quitAppMock).not.toHaveBeenCalled();
    expect(revealWindowMock).toHaveBeenCalledOnce();
    expect(result.current.exitConfirm).toEqual({ scan: false, download: true, cleaning: false });
  });

  it("names a running cleanup reported by the sweep", () => {
    quitAppMock.mockClear();
    revealWindowMock.mockClear();
    revealWindowMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useExitGate(idle));
    act(() => result.current.onCleaningActivity(true));
    act(() => result.current.requestExit());
    expect(revealWindowMock).toHaveBeenCalledOnce();
    expect(result.current.exitConfirm).toEqual({ scan: false, download: false, cleaning: true });
  });
});
