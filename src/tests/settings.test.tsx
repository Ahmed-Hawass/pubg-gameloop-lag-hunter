// tests/settings.test.tsx — the language picker contract through the
// real provider: a successful switch persists and re-renders, a failed
// write rolls back visibly to the previous language (self-evident, no
// modal by design).

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { LanguageProvider } from "../i18n";
import { SettingsView } from "../views/SettingsView";
import { settings } from "./fixtures";

const apiMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setLanguage: vi.fn(),
}));

vi.mock("../bridge", () => ({
  api: apiMock,
}));

function open() {
  apiMock.getSettings.mockResolvedValue(settings({ language: "en" }));
  render(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(SettingsView, {
        theme: "dark",
        onThemeChange: vi.fn(),
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
});
