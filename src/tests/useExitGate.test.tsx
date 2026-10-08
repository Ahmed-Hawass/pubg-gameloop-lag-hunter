// tests/useExitGate.test.tsx — the X-button gate: quiet work closes
// straight away, a running scan or an active download/cleaning names
// itself in one confirm instead.

import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { APP_DIALOG_OPEN_EVENT } from "../components/components";
import { useExitGate } from "../useExitGate";
import type { StatusPayload } from "../bridge";

const closeWindowMock = vi.hoisted(() => vi.fn());

vi.mock("../bridge", () => ({
  api: {},
  closeWindow: closeWindowMock,
}));

const idle: StatusPayload = { status: "idle", ui: null };
const running: StatusPayload = { status: "running", ui: null };

describe("useExitGate", () => {
  it("closes straight away when nothing is in flight", () => {
    closeWindowMock.mockClear();
    const { result } = renderHook(() => useExitGate(idle));
    act(() => result.current.requestExit());
    expect(closeWindowMock).toHaveBeenCalledOnce();
    expect(result.current.exitConfirm).toBeNull();
  });

  it("names a running scan in one confirm instead", () => {
    closeWindowMock.mockClear();
    const seen: string[] = [];
    const onEvent = () => seen.push("app-dialog");
    window.addEventListener(APP_DIALOG_OPEN_EVENT, onEvent);
    const { result } = renderHook(() => useExitGate(running));
    act(() => result.current.requestExit());
    expect(closeWindowMock).not.toHaveBeenCalled();
    expect(result.current.exitConfirm).toEqual({ scan: true, download: false, cleaning: false });
    expect(seen).toEqual(["app-dialog"]);
    window.removeEventListener(APP_DIALOG_OPEN_EVENT, onEvent);
  });

  it("names an active download reported by the modal", () => {
    closeWindowMock.mockClear();
    const { result } = renderHook(() => useExitGate(idle));
    act(() => result.current.onDownloadActivity(true));
    act(() => result.current.requestExit());
    expect(closeWindowMock).not.toHaveBeenCalled();
    expect(result.current.exitConfirm).toEqual({ scan: false, download: true, cleaning: false });
  });

  it("names a running cleanup reported by the sweep", () => {
    closeWindowMock.mockClear();
    const { result } = renderHook(() => useExitGate(idle));
    act(() => result.current.onCleaningActivity(true));
    act(() => result.current.requestExit());
    expect(result.current.exitConfirm).toEqual({ scan: false, download: false, cleaning: true });
  });
});
