// tests/toolsGaming.test.tsx — the gaming switches contract: rows mirror
// the live registry read, a flip writes the mapped value optimistically,
// a verified write stays, an unverified one rolls back with a notice, and
// a refused elevation ("cancelled") rolls back silently.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { ToolsView } from "../views/ToolsView";
import { pagefileSettings, tweakStates } from "./fixtures";

const apiMock = vi.hoisted(() => ({
  tweakStates: vi.fn(),
  pagefileSettings: vi.fn(),
  setTweak: vi.fn(),
  storageScan: vi.fn(),
  storageDeepScan: vi.fn(),
  storageClean: vi.fn(),
  validatePagefileSettings: vi.fn(),
  applyPagefileSettings: vi.fn(),
  scheduleReboot: vi.fn(),
}));

vi.mock("../bridge", () => ({
  api: apiMock,
  notifyFeatureStateChanged: vi.fn(),
}));

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
}));

function openGaming() {
  apiMock.tweakStates.mockResolvedValue(tweakStates({ game_dvr_enabled: false }));
  apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
  render(
    React.createElement(ToolsView, {
      active: true,
      toolOpenId: null,
      onToolOpened: vi.fn(),
    }),
  );
}

describe("ToolsView gaming switches", () => {
  it("landing opens the gaming details with one live read", async () => {
    const user = userEvent.setup();
    openGaming();
    await user.click(screen.getByText(en.toolGamingTweaks));
    await screen.findByText(en.tweakDvrTitle);
    expect(apiMock.tweakStates).toHaveBeenCalledTimes(1);
    // the gaming page never consumed page file data: the split stopped
    // paying its read here (one fewer IPC round-trip, same pixels)
    expect(apiMock.pagefileSettings).not.toHaveBeenCalled();
  });

  it("a client update raises the re-flip notice once, with its version", async () => {
    const user = userEvent.setup();
    apiMock.tweakStates.mockResolvedValue(
      tweakStates({
        game_dvr_enabled: false,
        emulator_updated: true,
        emulator_version: "7.0.19.05",
      }),
    );
    apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
    render(
      React.createElement(ToolsView, {
        active: true,
        toolOpenId: null,
        onToolOpened: vi.fn(),
      }),
    );
    await user.click(screen.getByText(en.toolGamingTweaks));
    await screen.findByText(en.dialog.emulatorUpdatedTitle);
    expect(screen.getByText(en.dialog.emulatorUpdatedBody("7.0.19.05"))).toBeTruthy();
    // dismissing clears a notice like any other: one dialog, then gone
    await user.click(screen.getByText(en.dialog.ok));
    expect(screen.queryByText(en.dialog.emulatorUpdatedTitle)).toBeNull();
  });

  it("hides rows the Windows build lacks instead of a dead switch", async () => {
    const user = userEvent.setup();
    openGaming();
    await user.click(screen.getByText(en.toolGamingTweaks));
    await screen.findByText(en.tweakDvrTitle);
    // power_high_perf/gpu/fso/windowed are "hidden"/null in the fixture
    expect(screen.queryByText(en.tweakPowerTitle)).toBeNull();
    expect(screen.queryByText(en.tweakGpuTitle)).toBeNull();
  });

  it("verified flip writes the mapped value and stays put", async () => {
    const user = userEvent.setup();
    apiMock.setTweak.mockResolvedValue({
      id: "dvr",
      previous: 0,
      value: 1,
      verified: true,
    });
    openGaming();
    await user.click(screen.getByText(en.toolGamingTweaks));
    const row = await screen.findByText(en.tweakDvrTitle);
    const sw = within(row.closest(".switch-row")!).getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "true"); // dvrOn mirrors !enabled
    await user.click(sw);
    await waitFor(() => {
      expect(apiMock.setTweak).toHaveBeenCalledWith("dvr", 1);
    });
    // optimistic flip holds: still on, no failure dialog
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText(en.tweakFailed)).toBeNull();
  });

  it("unverified flip rolls back with a notice dialog", async () => {
    const user = userEvent.setup();
    apiMock.setTweak.mockResolvedValue({
      id: "dvr",
      previous: 0,
      value: 1,
      verified: false,
    });
    openGaming();
    await user.click(screen.getByText(en.toolGamingTweaks));
    const row = await screen.findByText(en.tweakDvrTitle);
    const sw = within(row.closest(".switch-row")!).getByRole("switch");
    await user.click(sw);
    await screen.findByText(en.tweakFailed);
    // rolled back to the pre-flip truth
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it('refused elevation ("cancelled") rolls back silently', async () => {
    const user = userEvent.setup();
    apiMock.setTweak.mockRejectedValue("cancelled");
    openGaming();
    await user.click(screen.getByText(en.toolGamingTweaks));
    const row = await screen.findByText(en.tweakDvrTitle);
    const sw = within(row.closest(".switch-row")!).getByRole("switch");
    await user.click(sw);
    await waitFor(() => {
      expect(sw).toHaveAttribute("aria-checked", "true");
    });
    expect(screen.queryByText(en.tweakFailed)).toBeNull();
    expect(screen.queryByText(en.dialog.somethingWrong)).toBeNull();
  });
});
