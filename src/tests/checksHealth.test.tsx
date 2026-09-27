// tests/checksHealth.test.tsx — the summary banner contract: one-glance
// verdict derived from the five checks (zero backend cost), featured
// warnings that REPEAT the archive cards (never replace them), and an
// archive that keeps every open button (no functional regression).

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { en } from "../locales/en";
import { ChecksView } from "../views/ChecksView";
import type { SystemChecks } from "../bridge";

const apiMock = vi.hoisted(() => ({
  systemChecks: vi.fn(),
  openWindowsPanel: vi.fn(),
}));

vi.mock("../bridge", () => ({
  api: apiMock,
  FEATURE_STATE_CHANGED_EVENT: "laghunter:feature-state-changed",
}));

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
}));

const allGood: SystemChecks = {
  power_name: "High performance",
  power_ok: true,
  pagefile_mode: "auto",
  pagefile_mb: 0,
  pagefile_ok: true,
  laptop: false,
  on_ac: true,
  vt_enabled: true,
  game_dvr_enabled: false,
  storage_sense: false,
};

const threeWarns: SystemChecks = {
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

describe("ChecksView health summary", () => {
  it("all green shows the good banner and no attention section", async () => {
    apiMock.systemChecks.mockResolvedValue(allGood);
    render(React.createElement(ChecksView, { active: false, onOpenTool: vi.fn() }));
    await screen.findByText(en.healthAllGood);
    expect(screen.getByText(en.healthAllGoodSub)).toBeTruthy();
    expect(screen.getByText(en.healthAllSettings)).toBeTruthy();
    // no warn badge anywhere: neither featured nor archive may invent one
    expect(screen.queryByText(en.checkWarnBadge)).toBeNull();
    // healthy cards own no destination: no shortcut may appear beside them
    expect(screen.queryByText(en.openInTools)).toBeNull();
    // no doubled verdict: the state line carries the bare value
    // ("High performance", not "High performance: good") while the
    // badge alone says Good
    expect(screen.getByText("High performance")).toBeTruthy();
  });

  it("warnings show a counted banner plus featured cards above the archive", async () => {
    apiMock.systemChecks.mockResolvedValue(threeWarns);
    render(React.createElement(ChecksView, { active: false, onOpenTool: vi.fn() }));
    await screen.findByText(en.healthNeedsTitle(3));
    expect(screen.getByText(en.healthNeedsSub)).toBeTruthy();
    // each warning repeats: once featured, once in the archive
    for (const name of [en.checkPower, en.checkDvr, en.checkPagefile]) {
      expect(screen.getAllByText(name)).toHaveLength(2);
    }
    // the healthy row renders once (archive only, never featured)
    expect(screen.getAllByText(en.checkVt)).toHaveLength(1);
  });

  it("the archive keeps every open button (featured cards add, never move)", async () => {
    apiMock.systemChecks.mockResolvedValue(threeWarns);
    render(React.createElement(ChecksView, { active: false, onOpenTool: vi.fn() }));
    await screen.findByText(en.healthNeedsTitle(3));
    // 3 destinations x 2 sections: moving a button instead of repeating
    // it would silently cut the archive's deep-links in half
    expect(screen.getAllByText(en.openInTools)).toHaveLength(6);
  });
});
