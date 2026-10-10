// tests/zoom.test.ts — the fixed zoom ladder: every UI surface (pills,
// shortcuts, stored values) speaks these steps, so no surface can
// invent an off-ladder value. Nearest wins, first step wins ties.

import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ZOOM_LEVELS, nearestZoomLevel, useUiZoom } from "../useUiZoom";
import { settings } from "./fixtures";

const apiMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setUiZoom: vi.fn(),
}));

const setWebviewZoomMock = vi.hoisted(() => vi.fn());

vi.mock("../bridge", () => ({
  api: apiMock,
  setWebviewZoom: setWebviewZoomMock,
}));

// native zoom applies through the WebView (always resolves in tests)
setWebviewZoomMock.mockResolvedValue(undefined);

describe("zoom ladder", () => {
  it("holds the documented steps", () => {
    expect(ZOOM_LEVELS).toEqual([80, 100, 125]);
  });

  it("snaps any percent to its nearest step", () => {
    expect(nearestZoomLevel(100)).toBe(100);
    expect(nearestZoomLevel(125)).toBe(125);
    expect(nearestZoomLevel(0)).toBe(80);
    expect(nearestZoomLevel(9999)).toBe(125);
    expect(nearestZoomLevel(107)).toBe(100);
    expect(nearestZoomLevel(104)).toBe(100);
    // ties fall to the lower step, deterministically
    expect(nearestZoomLevel(90)).toBe(80);
  });
});

describe("useUiZoom", () => {
  it("reads the persisted level on mount and applies it", async () => {
    apiMock.getSettings.mockResolvedValue(settings({ ui_zoom_pct: 125 }));
    apiMock.setUiZoom.mockResolvedValue(125);
    const { result } = renderHook(() => useUiZoom());
    await waitFor(() => {
      expect(result.current.zoom).toBe(125);
    });
    expect(setWebviewZoomMock).toHaveBeenCalledWith(1.25);
  });

  it("snaps, applies, and persists every change", async () => {
    apiMock.getSettings.mockResolvedValue(settings());
    // the persist echo is meaningless by design (fixed mock value the
    // hook must ignore): the applied value stays the truth
    apiMock.setUiZoom.mockResolvedValue(110);
    const { result } = renderHook(() => useUiZoom());
    // settled mount first (a bare act plus sync read cannot observe
    // mocked async continuations deterministically)
    await waitFor(() => {
      expect(setWebviewZoomMock).toHaveBeenCalledWith(1);
    });
    // off-ladder input snaps before it touches pixels or disk
    await act(async () => {
      result.current.setZoomPct(107);
    });
    await waitFor(() => {
      expect(result.current.zoom).toBe(100);
    });
    expect(setWebviewZoomMock).toHaveBeenCalledWith(1);
    expect(apiMock.setUiZoom).toHaveBeenCalledWith(100);
    // steps walk the ladder and stop at its ends (late continuations
    // from the previous persist belong to an older generation and
    // must never clobber the newer action)
    await act(async () => {
      result.current.zoomIn();
    });
    await waitFor(() => {
      expect(result.current.zoom).toBe(125);
    });
    await act(async () => {
      result.current.zoomIn();
    });
    await waitFor(() => {
      expect(result.current.zoom).toBe(125);
    });
    await act(async () => {
      result.current.resetZoom();
    });
    await waitFor(() => {
      expect(result.current.zoom).toBe(100);
    });
  });

  it("rolls pixels visibly back on a failed persist", async () => {
    apiMock.getSettings.mockResolvedValue(settings());
    apiMock.setUiZoom.mockRejectedValueOnce("disk gone");
    const { result } = renderHook(() => useUiZoom());
    await waitFor(() => {
      expect(result.current.zoom).toBe(100);
    });
    await act(async () => {
      result.current.setZoomPct(125);
    });
    // optimistic pixels first, then the rollback lands on stored truth
    await waitFor(() => {
      expect(result.current.zoom).toBe(100);
    });
    expect(setWebviewZoomMock).toHaveBeenCalledWith(1);
  });
});
