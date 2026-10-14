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

const allGood: SystemChecks = {
  power_name: "High performance",
  power_ok: true,
  pagefile_mode: "auto",
  pagefile_mb: 0,
  pagefile_ok: true,
  pagefile_pending: false,
  laptop: false,
  on_ac: true,
  vt_enabled: true,
  game_dvr_enabled: false,
  memory_integrity_off: true,
  memory_integrity_pending: false,
  memory_integrity_supported: true,
  storage_sense: false,
};

const threeWarns: SystemChecks = {
  power_name: "Balanced",
  power_ok: false,
  pagefile_mode: "manual",
  pagefile_mb: 4096,
  pagefile_ok: false,
  pagefile_pending: false,
  laptop: true,
  on_ac: true,
  vt_enabled: true,
  game_dvr_enabled: true,
  memory_integrity_off: true,
  memory_integrity_pending: false,
  memory_integrity_supported: true,
  storage_sense: false,
};

describe("ChecksView health summary", () => {
  it("all green shows the good banner and no attention section", async () => {
    apiMock.systemChecks.mockResolvedValue(allGood);
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ChecksView, { active: false, onOpenTool: vi.fn() }));
    await screen.findByText(en.healthAllGood);
    expect(screen.getByText(en.healthAllGoodSub)).toBeTruthy();
    // new user: the one-shot page card explains banner and shortcuts
    expect(screen.getByText(en.introHealthTitle)).toBeTruthy();
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
    apiMock.getSettings.mockResolvedValue(settings());
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
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ChecksView, { active: false, onOpenTool: vi.fn() }));
    await screen.findByText(en.healthNeedsTitle(3));
    // 3 destinations x 2 sections: moving a button instead of repeating
    // it would silently cut the archive's deep-links in half
    expect(screen.getAllByText(en.openInTools)).toHaveLength(6);
  });

  it("the banner carries no manual refresh (poll plus focus own it)", async () => {
    apiMock.systemChecks.mockResolvedValue(allGood);
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ChecksView, { active: false, onOpenTool: vi.fn() }));
    await screen.findByText(en.healthAllGood);
    // the verdict banner is display-only; the error state below owns
    // the single retry button
    expect(document.querySelector(".health-banner button")).toBeNull();
  });

  it("the error state keeps its retry button", async () => {
    apiMock.systemChecks.mockRejectedValue("boom");
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ChecksView, { active: false, onOpenTool: vi.fn() }));
    await screen.findByText(en.dialog.somethingWrong);
    expect(screen.getByRole("button", { name: en.refresh })).toBeTruthy();
  });

  it("a pending page file write names the reboot wait", async () => {    apiMock.systemChecks.mockResolvedValue({
      ...allGood,
      pagefile_mode: "manual",
      pagefile_mb: 16384,
      pagefile_ok: true,
      pagefile_pending: true,
    });
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ChecksView, { active: false, onOpenTool: vi.fn() }));
    // configured truth plus the same pending badge the editor shows,
    // composed into one state line
    const state = await screen.findByText((_, el) => el?.textContent === `${en.pagefileManual(16384)} · ${en.tweakPfPendingBadge}`);
    expect(state.getAttribute("class")).toContain("switch-state");
  });

  it("hint buttons announce their context, never a bare duplicate", async () => {
    apiMock.systemChecks.mockResolvedValue(allGood);
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ChecksView, { active: false, onOpenTool: vi.fn() }));
    await screen.findByText(en.healthAllGood);
    const hints = document.querySelectorAll(".switch-hint");
    expect(hints.length).toBeGreaterThan(0);
    hints.forEach((b) => {
      const label = b.getAttribute("aria-label") ?? "";
      expect(label.startsWith("About ")).toBe(true);
    });
  });

  it("names the page with a standing header above the banner", async () => {
    apiMock.systemChecks.mockResolvedValue(allGood);
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ChecksView, { active: false, onOpenTool: vi.fn() }));
    await screen.findByText(en.healthAllGood);
    // permanent identity (unlike the one-shot card): tab name plus the
    // standing scope line, both above the verdict banner
    expect(screen.getByText(en.systemHealth)).toBeTruthy();
    expect(screen.getByText(en.checksHint)).toBeTruthy();
  });

  it("a requested Memory Integrity warns with the restart wait when pending", async () => {
    apiMock.systemChecks.mockResolvedValue({
      ...allGood,
      memory_integrity_off: false,
      memory_integrity_pending: true,
    });
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ChecksView, { active: false, onOpenTool: vi.fn() }));
    // warn card (featured + archive) with the composed state line
    expect(await screen.findAllByText(en.checkHvci)).toHaveLength(2);
    const states = await screen.findAllByText(
      (_, el) => el?.textContent === `${en.checkHvciOn} · ${en.tweakHvciPendingBadge}`,
    );
    expect(states).toHaveLength(2);
    expect(states[0].getAttribute("class")).toContain("switch-state");
  });

  it("an unsupported build hides the Memory Integrity card entirely", async () => {
    apiMock.systemChecks.mockResolvedValue({
      ...allGood,
      memory_integrity_supported: false,
    });
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ChecksView, { active: false, onOpenTool: vi.fn() }));
    await screen.findByText(en.healthAllGood);
    // no card, no hint, no button: reporting on an absent feature
    // would be fiction
    expect(screen.queryByText(en.checkHvci)).toBeNull();
  });
});
