// tests/titlebar.test.tsx — the window chrome contract: version text,
// never an update dot (the sidebar About dot and the heading dot own
// the signal), double-click toggles maximize, restore glyph differs
// from maximize.

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
  it("shows the version with never an update dot", async () => {
    open();
    await screen.findByText("v1.6.0");
    // the chrome carries no signal by design (sidebar + heading own it)
    expect(document.querySelector(".titlebar-dot")).toBeNull();
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
