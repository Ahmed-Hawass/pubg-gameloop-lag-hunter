// tests/toolsTweaksHealth.test.tsx — the gaming rows follow the health
// pattern: one-glance banner derived from the rendered rows, off-rows
// repeated featured above the archive (never moved), row copy is the
// name alone with the definition behind the (?) button.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

/** every rendered row on: power/gpu/fso hidden stays hidden, the rest on */
const allOn = tweakStates({
  game_dvr_enabled: false,
  game_mode: true,
  mouse_accel_off: true,
  windowed_game_opt: true,
  power_high_perf: "on",
});

async function openGamingWith(states: ReturnType<typeof tweakStates>) {
  const user = userEvent.setup();
  apiMock.tweakStates.mockResolvedValue(states);
  apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
  render(
    React.createElement(ToolsView, {
      active: true,
      toolOpenId: null,
      onToolOpened: vi.fn(),
    }),
  );
  await user.click(screen.getByText(en.toolGamingTweaks));
  // an off DVR renders twice (featured + archive): wait for all of them
  await screen.findAllByText(en.tweakDvrTitle);
  return { user };
}

describe("ToolsView gaming summary", () => {
  it("all on shows the good banner and no attention section", async () => {
    await openGamingWith(allOn);
    expect(screen.getByText(en.tweakBannerGood)).toBeTruthy();
    expect(screen.getByText(en.tweakBannerGoodSub)).toBeTruthy();
    expect(screen.getByText(en.tweakAllTweaks)).toBeTruthy();
    expect(screen.queryByText(en.checkWarnBadge)).toBeNull();
  });

  it("an off row shows a counted banner and repeats featured", async () => {
    await openGamingWith({ ...allOn, game_dvr_enabled: true });
    expect(screen.getByText(en.tweakBannerNeeds(1))).toBeTruthy();
    expect(screen.getByText(en.tweakBannerNeedsSub)).toBeTruthy();
    // featured + archive, never moved out of the archive
    expect(screen.getAllByText(en.tweakDvrTitle)).toHaveLength(2);
    expect(screen.getAllByText(en.tweakGameModeTitle)).toHaveLength(1);
  });

  it("the definition lives behind the (?) button, not on the row", async () => {
    const { user } = await openGamingWith(allOn);
    // the verified effect timing rides the card now (was fused in the hint)
    const row = screen.getByText(en.tweakDvrTitle);
    expect(
      row.closest(".switch-row")!.querySelector(".switch-state"),
    ).toHaveTextContent(en.tweakEffectNow);
    // rows without a verified timing show no line rather than a guess
    const gmRow = screen.getByText(en.tweakGameModeTitle);
    expect(
      gmRow.closest(".switch-row")!.querySelector(".switch-state"),
    ).toBeNull();
    const hintBtn = row
      .closest(".switch-row")!
      .querySelector("button.switch-hint")!;
    await user.click(hintBtn);
    // the dialog carries the definition with no duplicated timing line
    expect(screen.getByText(en.tweakDvrHint)).toBeTruthy();
  });

  it("the landing badge agrees with the details banner", async () => {
    const user = userEvent.setup();
    apiMock.tweakStates.mockResolvedValue({ ...allOn, game_dvr_enabled: true });
    apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
    render(
      React.createElement(ToolsView, {
        active: true,
        toolOpenId: null,
        onToolOpened: vi.fn(),
      }),
    );
    // 4 of 5 rendered rows on (power/gpu/fso hidden in the fixture)
    expect(await screen.findByText(en.toolBadgeOptimized(4, 5))).toBeTruthy();
    await user.click(screen.getByText(en.toolGamingTweaks));
    // the same single off-row drives the banner count inside
    expect(await screen.findByText(en.tweakBannerNeeds(1))).toBeTruthy();
  });
});
