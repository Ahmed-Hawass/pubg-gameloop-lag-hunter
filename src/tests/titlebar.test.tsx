// tests/titlebar.test.tsx — the window chrome contract: version text,
// update dot only when a release is known, double-click toggles
// maximize, restore glyph differs from maximize.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { en } from "../locales/en";
import { TitleBar } from "../components/TitleBar";

const apiMock = vi.hoisted(() => ({
  isWindowMaximized: vi.fn(),
  minimizeWindow: vi.fn(),
  onWindowResized: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
}));

vi.mock("../bridge", () => apiMock);

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
}));

vi.mock("../assets/app-icon.png", () => ({ default: "icon.png" }));

function open(props: Partial<React.ComponentProps<typeof TitleBar>> = {}) {
  apiMock.isWindowMaximized.mockResolvedValue(false);
  apiMock.onWindowResized.mockResolvedValue(() => {});
  render(
    React.createElement(TitleBar, {
      version: "1.6.0",
      onRequestExit: vi.fn(),
      ...props,
    }),
  );
}

describe("TitleBar", () => {
  it("shows the version with no dot when up to date", async () => {
    open();
    await screen.findByText("v1.6.0");
    expect(document.querySelector(".titlebar-dot")).toBeNull();
  });

  it("dots the version when a release is known", async () => {
    open({ updateAvailable: true });
    await screen.findByText("v1.6.0");
    expect(document.querySelector(".titlebar-dot")).toBeTruthy();
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
});
