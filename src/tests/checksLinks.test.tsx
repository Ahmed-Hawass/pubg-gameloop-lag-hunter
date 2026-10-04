// tests/checksLinks.test.tsx — the health cards are the deep-link
// senders: power/DVR jump into Tools rows, page file into its editor.
// Without the link callback the same buttons fall back to Windows.

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { ChecksView } from "../views/ChecksView";
import type { SystemChecks } from "../bridge";
import { settings } from "./fixtures";

const apiMock = vi.hoisted(() => ({
  systemChecks: vi.fn(),
  openWindowsPanel: vi.fn(),
  getSettings: vi.fn(),
  dismissIntroCard: vi.fn(),
}));

vi.mock("../bridge", () => ({
  api: apiMock,
  FEATURE_STATE_CHANGED_EVENT: "laghunter:feature-state-changed",
}));

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
}));

const checks: SystemChecks = {
  power_name: "Balanced",
  power_ok: false,
  pagefile_mode: "manual",
  pagefile_mb: 4096,
  pagefile_ok: false,
  laptop: true,
  on_ac: true,
  vt_enabled: true,
  game_dvr_enabled: true,
  storage_sense: false,
};

function open(onOpenTool?: (id: string) => void) {
  apiMock.systemChecks.mockResolvedValue(checks);
  apiMock.getSettings.mockResolvedValue(settings());
  const onOpen = onOpenTool ?? vi.fn();
  render(React.createElement(ChecksView, { active: true, onOpenTool: onOpen }));
  return { onOpen };
}

describe("ChecksView deep-link senders", () => {
  it("power, DVR and page file cards route into Tools rows", async () => {
    const user = userEvent.setup();
    const { onOpen } = open();
    await screen.findAllByText(en.checkPower);
    // warnings repeat (featured + archive): scope to the archive, whose
    // three jumps must keep working no matter what the summary does
    const archive = screen.getByText(en.healthAllSettings).closest("section");
    expect(archive).toBeTruthy();
    const buttons = within(archive as HTMLElement).getAllByText(en.openInTools);
    expect(buttons).toHaveLength(3);
    await user.click(buttons[0]);
    expect(onOpen).toHaveBeenLastCalledWith("powerplan");
    await user.click(buttons[1]);
    expect(onOpen).toHaveBeenLastCalledWith("dvr");
    await user.click(buttons[2]);
    expect(onOpen).toHaveBeenLastCalledWith("pagefile");
    expect(apiMock.openWindowsPanel).not.toHaveBeenCalled();
  });

  it("without the link the buttons fall back to Windows panels", async () => {
    const user = userEvent.setup();
    apiMock.systemChecks.mockResolvedValue(checks);
  apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ChecksView, { active: true }));
    await screen.findAllByText(en.checkPower);
    const archive = screen.getByText(en.healthAllSettings).closest("section");
    await user.click(within(archive as HTMLElement).getAllByText(en.openSettings)[0]);
    expect(apiMock.openWindowsPanel).toHaveBeenCalledWith("power");
  });
});
