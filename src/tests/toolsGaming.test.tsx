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
import { cleanupHistory, pagefileSettings, settings, tweakStates } from "./fixtures";

const apiMock = vi.hoisted(() => ({
  tweakStates: vi.fn(),
  pagefileSettings: vi.fn(),
  cleanupHistory: vi.fn(),
  clockHour12: vi.fn(),
  getSettings: vi.fn(),
  dismissIntroCard: vi.fn(),
  setTweak: vi.fn(),
  storageScan: vi.fn(),
  storageDeepScan: vi.fn(),
  storageClean: vi.fn(),
  validatePagefileSettings: vi.fn(),
  applyPagefileSettings: vi.fn(),
  scheduleReboot: vi.fn(),
}));

// page intros read settings on mount: default to a fresh machine (every
// card shows) unless a test overrides the dismissed list below
apiMock.getSettings.mockResolvedValue(settings());
apiMock.dismissIntroCard.mockResolvedValue(undefined);

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
  apiMock.cleanupHistory.mockResolvedValue(cleanupHistory());
  apiMock.clockHour12.mockResolvedValue(false);
  render(
    React.createElement(ToolsView, {
      active: true,
      toolOpenId: null,
      onToolOpened: vi.fn(),
      showUnsupported: false,
      onShowUnsupported: vi.fn(),
    }),
  );
}

describe("ToolsView gaming switches", () => {
  it("landing opens the gaming details with live reads", async () => {
    const user = userEvent.setup();
    openGaming();
    await user.click(screen.getByText(en.toolGamingTweaks));
    await screen.findByText(en.tweakDvrTitle);
    // landing badges read first (tweaks + page file, one each), then the
    // details page reloads its own tweaks (it never waits on the badge)
    expect(apiMock.tweakStates).toHaveBeenCalledTimes(2);
    // the gaming page never consumed page file data: the details reload
    // pays only the tweak read (one fewer IPC round-trip, same pixels)
    expect(apiMock.pagefileSettings).toHaveBeenCalledTimes(1);
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
        showUnsupported: false,
        onShowUnsupported: vi.fn(),
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

  it("reveals hidden rows greyed with reasons under the preference", async () => {
    const user = userEvent.setup();
    apiMock.tweakStates.mockResolvedValue(
      tweakStates({ power_high_perf: "hidden_ultimate", gpu_high_perf: "hidden_old_build" }),
    );
    apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
    apiMock.cleanupHistory.mockResolvedValue(cleanupHistory());
    render(
      React.createElement(ToolsView, {
        active: true,
        toolOpenId: null,
        onToolOpened: vi.fn(),
        showUnsupported: true,
        onShowUnsupported: vi.fn(),
      }),
    );
    // attention stays actionable: revealed rows join neither count
    // (landing badge first: it unmounts with the page behind it)
    await screen.findByText(en.toolBadgeOptimized(0, 3));
    await user.click(screen.getByText(en.toolGamingTweaks));
    // each names its exact engine cause (never a generic "unavailable")
    await screen.findByText(en.tweakHiddenUltimate);
    expect(screen.getByText(en.tweakNeeds1803)).toBeTruthy();
    expect(screen.getByText(en.tweakNeedsWin11)).toBeTruthy();
    // greyed and unflippable: revealed rows carry no switch action
    const powerRow = screen.getByText(en.tweakPowerTitle).closest(".switch-row")!;
    expect(powerRow.querySelector(".switch")).toBeDisabled();
    expect(screen.getByText(en.tweakBannerNeeds(3))).toBeTruthy();
  });

  it("names hidden rows with a discover line until shown", async () => {
    const user = userEvent.setup();
    const onShowUnsupported = vi.fn();
    apiMock.tweakStates.mockResolvedValue(
      tweakStates({ power_high_perf: "hidden_s0", gpu_high_perf: "hidden_old_build" }),
    );
    apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
    apiMock.cleanupHistory.mockResolvedValue(cleanupHistory());
    render(
      React.createElement(ToolsView, {
        active: true,
        toolOpenId: null,
        onToolOpened: vi.fn(),
        showUnsupported: false,
        onShowUnsupported,
      }),
    );
    await user.click(screen.getByText(en.toolGamingTweaks));
    // off DVR renders featured plus archive: the page is open either way
    await screen.findAllByText(en.tweakDvrTitle);
    // hidden rows stay hidden, but the page admits they exist
    expect(screen.queryByText(en.tweakPowerTitle)).toBeNull();
    await user.click(screen.getByText(en.showUnsupportedLink));
    expect(onShowUnsupported).toHaveBeenCalledOnce();
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

  it("landing names the tab with its scope line above the cards", async () => {
    openGaming();
    // static header, not an intro card: present on every visit, and it
    // states the tab rule instead of repeating the card descriptions
    expect(await screen.findByText(en.toolsScope)).toBeTruthy();
    expect(screen.getByText(en.tools)).toBeTruthy();
  });

  it("gaming section opens under a standing header with the card below it", async () => {
    const user = userEvent.setup();
    openGaming();
    await user.click(screen.getByText(en.toolGamingTweaks));
    // the header names the section from the first paint (short scope
    // line, never the card body), the card explains it once below
    const head = document.querySelector(".page-head");
    expect(head?.textContent).toContain(en.toolGamingTweaks);
    expect(head?.textContent).toContain(en.toolGamingTweaksDesc);
    await screen.findByText(en.introGamingTitle);
    expect(screen.getByText(en.introGamingBody)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: en.dialog.dismiss }));
    await waitFor(() => {
      expect(apiMock.dismissIntroCard).toHaveBeenCalledWith("gaming");
    });
    // the card leaves, the standing header stays
    expect(document.querySelector(".intro-card")).toBeNull();
    expect(document.querySelector(".page-head")?.textContent).toContain(en.toolGamingTweaks);
  });

  it("back control rides the header row end, opposite the title", async () => {
    const user = userEvent.setup();
    openGaming();
    await user.click(screen.getByText(en.toolGamingTweaks));
    await screen.findByText(en.tweakDvrTitle);
    // one shared row: header plus the back control at the inline end,
    // never a lonely button row above — and the intro card rides BELOW
    // the row at full width, never squeezed beside the button
    const top = document.querySelector(".section-top");
    expect(top).toBeTruthy();
    expect(top?.querySelector(".back-btn")?.textContent).toContain(en.toolsBack);
    expect(top?.querySelector(".page-head")).toBeTruthy();
    expect(top?.querySelector(".intro-card")).toBeNull();
    expect(document.querySelector(".page-intro .intro-card")).toBeTruthy();
  });

  it("memory integrity flips off through one elevated write", async () => {
    const user = userEvent.setup();
    apiMock.tweakStates.mockResolvedValue(
      tweakStates({ memory_integrity: "off" }),
    );
    apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
    apiMock.cleanupHistory.mockResolvedValue(cleanupHistory());
    apiMock.clockHour12.mockResolvedValue(false);
    apiMock.setTweak.mockClear();
    apiMock.setTweak.mockResolvedValue({
      id: "memoryintegrity",
      previous: 1,
      value: 0,
      verified: true,
    });
    render(
      React.createElement(ToolsView, {
        active: true,
        toolOpenId: null,
        onToolOpened: vi.fn(),
        showUnsupported: false,
        onShowUnsupported: vi.fn(),
      }),
    );
    await user.click(screen.getByText(en.toolGamingTweaks));
    // off rows repeat (featured + archive, same row twice): flip the first
    const rows = await screen.findAllByText(en.tweakHvciTitle);
    const row = rows[0];
    const sw = within(row.closest(".switch-row")!).getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "false"); // protection running
    // the restart wait rides the row always (every flip needs a reboot:
    // verified timing, never a guessed line)
    expect(
      row.closest(".switch-row")!.querySelector(".switch-state"),
    ).toHaveTextContent(en.tweakEffectRestart);
    await user.click(sw);
    // ON means protection off: the write carries 0, like DVR's inverted goal
    await waitFor(() => {
      expect(apiMock.setTweak).toHaveBeenCalledWith("memoryintegrity", 0);
    });
  });

  it("a locked Memory Integrity row greys with its reason and never fires", async () => {
    const user = userEvent.setup();
    apiMock.tweakStates.mockResolvedValue(
      tweakStates({ memory_integrity: "locked_policy" }),
    );
    apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
    apiMock.cleanupHistory.mockResolvedValue(cleanupHistory());
    apiMock.clockHour12.mockResolvedValue(false);
    apiMock.setTweak.mockClear();
    render(
      React.createElement(ToolsView, {
        active: true,
        toolOpenId: null,
        onToolOpened: vi.fn(),
        showUnsupported: false,
        onShowUnsupported: vi.fn(),
      }),
    );
    await user.click(screen.getByText(en.toolGamingTweaks));
    const row = await screen.findByText(en.tweakHvciTitle);
    expect(screen.getByText(en.tweakHvciLockedReason)).toBeTruthy();
    // greyed and unflippable like every revealed-unsupported row
    const sw = row.closest(".switch-row")!.querySelector(".switch")!;
    expect(sw).toBeDisabled();
    await user.click(sw);
    expect(apiMock.setTweak).not.toHaveBeenCalled();
  });

  it("the row always names the restart wait", async () => {
    const user = userEvent.setup();
    apiMock.tweakStates.mockResolvedValue(
      tweakStates({ memory_integrity: "on" }),
    );
    apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
    apiMock.cleanupHistory.mockResolvedValue(cleanupHistory());
    apiMock.clockHour12.mockResolvedValue(false);
    render(
      React.createElement(ToolsView, {
        active: true,
        toolOpenId: null,
        onToolOpened: vi.fn(),
        showUnsupported: false,
        onShowUnsupported: vi.fn(),
      }),
    );
    await user.click(screen.getByText(en.toolGamingTweaks));
    const row = await screen.findByText(en.tweakHvciTitle);
    // the verified effect timing rides the row (never a guessed line)
    expect(
      row.closest(".switch-row")!.querySelector(".switch-state"),
    ).toHaveTextContent(en.tweakEffectRestart);
  });

  it("a pre-1803 build reveals the row greyed under the preference", async () => {
    const user = userEvent.setup();
    apiMock.tweakStates.mockResolvedValue(
      tweakStates({ memory_integrity: "hidden_old_build" }),
    );
    apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
    apiMock.cleanupHistory.mockResolvedValue(cleanupHistory());
    apiMock.clockHour12.mockResolvedValue(false);
    render(
      React.createElement(ToolsView, {
        active: true,
        toolOpenId: null,
        onToolOpened: vi.fn(),
        showUnsupported: true,
        onShowUnsupported: vi.fn(),
      }),
    );
    await user.click(screen.getByText(en.toolGamingTweaks));
    const row = await screen.findByText(en.tweakHvciTitle);
    expect(screen.getByText(en.tweakNeeds1803)).toBeTruthy();
    expect(row.closest(".switch-row")!.querySelector(".switch")).toBeDisabled();
  });
});
