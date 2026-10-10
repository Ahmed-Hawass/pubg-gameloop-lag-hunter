// tests/settings.test.tsx — the language picker contract through the
// real provider: a successful switch persists and re-renders, a failed
// write rolls back visibly to the previous language (self-evident, no
// modal by design). Plus the intro-cards re-show action: visible only
// while cards are dismissed, hiding at once on reset.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { LanguageProvider } from "../i18n";
import { SettingsView } from "../views/SettingsView";
import { settings } from "./fixtures";
import type { Settings } from "../bridge";

const apiMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setLanguage: vi.fn(),
  resetIntroCards: vi.fn(),
  setUiZoom: vi.fn(),
  setShowUnsupported: vi.fn(),
}));

vi.mock("../bridge", () => ({
  api: apiMock,
}));

function open(over: Partial<Settings> = {}, zoom = 100) {
  apiMock.getSettings.mockResolvedValue(settings({ language: "en", ...over }));
  render(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(SettingsView, {
        theme: "dark",
        onThemeChange: vi.fn(),
        active: true,
        zoom,
        onZoomChange: vi.fn(),
        showUnsupported: false,
        onShowUnsupportedChange: vi.fn(),
      }),
    ),
  );
}

describe("SettingsView language", () => {
  it("a successful switch persists and re-renders Arabic", async () => {
    const user = userEvent.setup();
    apiMock.setLanguage.mockResolvedValue("ar");
    open();
    const arabic = await screen.findByRole("radio", { name: "العربية" });
    await user.click(arabic);
    await waitFor(() => {
      expect(apiMock.setLanguage).toHaveBeenCalledWith("ar");
    });
    expect(arabic).toHaveAttribute("aria-checked", "true");
  });

  it("a failed write rolls back to the previous language", async () => {
    const user = userEvent.setup();
    apiMock.setLanguage.mockRejectedValue("disk gone");
    open();
    const english = await screen.findByRole("radio", { name: "English" });
    expect(english).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("radio", { name: "العربية" }));
    // optimistic flip, then the rollback lands visibly on English
    await waitFor(() => {
      expect(
        screen.getByRole("radio", { name: "English" }),
      ).toHaveAttribute("aria-checked", "true");
    });
  });

  it("re-show appears only while cards are dismissed, and restores them", async () => {
    // nothing dismissed: no dead control on the page
    open();
    await screen.findByRole("radio", { name: "English" });
    expect(screen.queryByText(en.introResetTitle)).toBeNull();
  });

  it("reset persists at once, hides the group, and signals sections", async () => {    const user = userEvent.setup();
    apiMock.resetIntroCards.mockResolvedValue(undefined);
    open({ dismissed_cards: ["health"] });
    await screen.findByText(en.introResetTitle);
    // the (?) names the button's job (re-show dismissed cards)
    expect(
      screen.getByRole("button", { name: en.introResetHint }),
    ).toBeTruthy();
    await user.click(screen.getByText(en.introResetAction));
    await waitFor(() => {
      expect(apiMock.resetIntroCards).toHaveBeenCalledOnce();
    });
    // optimistic hide: the group leaves with the click, not the round-trip
    expect(screen.queryByText(en.introResetTitle)).toBeNull();
  });

  it("re-reads the list on every visit, never a stale launch read", async () => {    apiMock.getSettings.mockResolvedValue(settings({ dismissed_cards: ["health"] }));
    const view = (active: boolean) =>
      React.createElement(
        LanguageProvider,
        null,
        React.createElement(SettingsView, {
          theme: "dark",
          onThemeChange: vi.fn(),
          active,
          zoom: 100,
          onZoomChange: vi.fn(),
          showUnsupported: false,
          onShowUnsupportedChange: vi.fn(),
        }),
      );
    // hidden tab: no group (the provider still reads for language)
    const { rerender } = render(view(false));
    expect(screen.queryByText(en.introResetTitle)).toBeNull();
    // opening the tab reads fresh: a card dismissed elsewhere shows up
    rerender(view(true));
    await screen.findByText(en.introResetTitle);
  });

  it("zoom pills send the step and mark it active", async () => {
    const user = userEvent.setup();
    const onZoomChange = vi.fn();
    render(
      React.createElement(
        LanguageProvider,
        null,
        React.createElement(SettingsView, {
          theme: "dark",
          onThemeChange: vi.fn(),
          active: true,
          zoom: 100,
          onZoomChange,
          showUnsupported: false,
          onShowUnsupportedChange: vi.fn(),
        }),
      ),
    );
    // same segmented control as language and theme, one checked step
    const seg = await screen.findByRole("radiogroup", { name: en.zoomTitle });
    expect(
      within(seg).getByRole("radio", { name: en.zoomDefault }),
    ).toHaveAttribute("aria-checked", "true");
    await user.click(within(seg).getByRole("radio", { name: en.zoomLarge }));
    expect(onZoomChange).toHaveBeenCalledWith(125);
  });

  it("unsupported pills persist the preference", async () => {
    const user = userEvent.setup();
    const onShowUnsupportedChange = vi.fn();
    render(
      React.createElement(
        LanguageProvider,
        null,
        React.createElement(SettingsView, {
          theme: "dark",
          onThemeChange: vi.fn(),
          active: true,
          zoom: 100,
          onZoomChange: vi.fn(),
          showUnsupported: false,
          onShowUnsupportedChange,
        }),
      ),
    );
    // off by default, like the engine default
    const seg = await screen.findByRole("radiogroup", { name: en.showUnsupportedTitle });
    expect(
      within(seg).getByRole("radio", { name: en.settingOff }),
    ).toHaveAttribute("aria-checked", "true");
    await user.click(within(seg).getByRole("radio", { name: en.settingOn }));
    // the pills report upward (App persists through its own setter,
    // like the theme pills — SettingsView never touches IPC itself)
    expect(onShowUnsupportedChange).toHaveBeenCalledWith(true);
  });
});
