// tests/titlebar.test.tsx — the window chrome contract: version text,
// never an update dot (the sidebar About dot and the heading dot own
// the signal), double-click toggles maximize, restore glyph differs
// from maximize, and X hides to the tray (never quits).

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { en } from "../locales/en";
import { TitleBar } from "../components/TitleBar";

const apiMock = vi.hoisted(() => ({
  isWindowMaximized: vi.fn(),
  minimizeWindow: vi.fn(),
  hideWindow: vi.fn(),
  onWindowResized: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
  syncSnapOverlay: vi.fn(),
  onSnapOverlay: vi.fn(),
}));

vi.mock("../bridge", () => apiMock);

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
}));

vi.mock("../assets/app-icon.png", () => ({ default: "icon.png" }));

function open(props: Partial<React.ComponentProps<typeof TitleBar>> = {}) {
  apiMock.isWindowMaximized.mockResolvedValue(false);
  apiMock.onWindowResized.mockResolvedValue(() => {});
  apiMock.syncSnapOverlay.mockResolvedValue(undefined);
  apiMock.onSnapOverlay.mockResolvedValue(() => {});
  apiMock.hideWindow.mockResolvedValue(undefined);
  render(
    React.createElement(TitleBar, {
      version: "1.6.0",
      ...props,
    }),
  );
}

describe("TitleBar", () => {
  it("shows the version with never an update dot", async () => {
    open();
    await screen.findByText("v1.6.0");
    // the chrome carries no signal by design (sidebar + heading own it)
    expect(document.querySelector(".titlebar-dot")).toBeNull();
  });

  it("reports the maximize button geometry to the snap overlay", async () => {
    open();
    await screen.findByText("v1.6.0");
    // jsdom measures zeros: the contract is the call itself (rect plus
    // scale), the backend hides a zero-size hit area instead of parking it
    await waitFor(() => {
      expect(apiMock.syncSnapOverlay).toHaveBeenCalled();
    });
    const rect = apiMock.syncSnapOverlay.mock.calls[0][0];
    expect(typeof rect.x).toBe("number");
    expect(typeof rect.width).toBe("number");
    expect(typeof rect.scale).toBe("number");
  });

  it("overlay hover mirrors the button highlight, overlay click toggles", async () => {
    let push!: (kind: "enter" | "leave" | "click") => void;
    apiMock.isWindowMaximized.mockResolvedValue(false);
    apiMock.onWindowResized.mockResolvedValue(() => {});
    apiMock.syncSnapOverlay.mockResolvedValue(undefined);
    apiMock.onSnapOverlay.mockImplementation((cb: (kind: "enter" | "leave" | "click") => void) => {
      push = cb;
      return Promise.resolve(() => {});
    });
    render(
      React.createElement(TitleBar, {
        version: "1.6.0",
      }),
    );
    await screen.findByText("v1.6.0");
    const btn = screen.getByRole("button", { name: en.maximize });
    // the native hit target owns the mouse: :hover cannot fire, so the
    // enter event paints the same fill through the mirror class
    act(() => push("enter"));
    expect(btn.className).toContain("snap-hover");
    act(() => push("leave"));
    expect(btn.className).not.toContain("snap-hover");
    // a click through the overlay runs the same toggle as the button
    await act(async () => push("click"));
    expect(apiMock.toggleMaximizeWindow).toHaveBeenCalled();
  });

  it("double-clicking the drag region toggles maximize", async () => {
    open();
    await screen.findByText("v1.6.0");
    fireEvent.doubleClick(
      screen.getByText(en.aboutTitle).closest("[data-tauri-drag-region]")!,
    );
    await waitFor(() => {
      expect(apiMock.toggleMaximizeWindow).toHaveBeenCalledOnce();
    });
  });

  it("X hides the window to the tray instead of quitting", async () => {
    open();
    await screen.findByText("v1.6.0");
    apiMock.hideWindow.mockClear();
    fireEvent.click(screen.getByRole("button", { name: en.hideToTray }));
    await waitFor(() => {
      expect(apiMock.hideWindow).toHaveBeenCalledOnce();
    });
  });
});
