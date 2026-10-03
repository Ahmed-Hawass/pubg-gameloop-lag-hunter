// tests/toolsStorage.test.tsx — the Storage card contract: it kept only
// the Storage Sense switch (page file and sweep own their cards now),
// its landing card badges the live sense state, the page carries the
// general banner plus featured plus archive pattern like gaming, and
// the switch still mirrors the live read with its background note.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { ToolsView } from "../views/ToolsView";
import { cleanupHistory, pagefileSettings, tweakStates } from "./fixtures";

const apiMock = vi.hoisted(() => ({
  tweakStates: vi.fn(),
  pagefileSettings: vi.fn(),
  cleanupHistory: vi.fn(),
  clockHour12: vi.fn(),
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

describe("ToolsView storage card", () => {
  it("opens a page with only the sense switch, page file lives elsewhere", async () => {
    const user = userEvent.setup();
    apiMock.tweakStates.mockResolvedValue(tweakStates({ storage_sense: true }));
    apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
    apiMock.cleanupHistory.mockResolvedValue(cleanupHistory());
  apiMock.clockHour12.mockResolvedValue(false);
    render(
      React.createElement(ToolsView, {
        active: true,
        toolOpenId: null,
        onToolOpened: vi.fn(),
        onCleaningChange: vi.fn(),
      }),
    );
    await user.click(screen.getByText(en.toolStorage));
    await screen.findByText(en.tweakSsTitle);
    // the moved-out neighbors left no trace on this page
    expect(screen.queryByText(en.tweakPfTitle)).toBeNull();
    expect(screen.queryByText(en.cleanupTitle)).toBeNull();
    // the switch mirrors the live read with its (?) note intact
    const row = screen.getByText(en.tweakSsTitle).closest(".switch-row")!;
    expect(row.querySelector('[aria-checked="true"]')).toBeTruthy();
    // holding reads good on the one-glance banner, like gaming
    expect(screen.getByText(en.tweakBannerGood)).toBeTruthy();
    expect(document.querySelector(".health-banner.ok")).toBeTruthy();
    // holding: archive only, no featured section
    expect(screen.queryByText(en.checkWarnBadge)).toBeNull();
    expect(screen.getByText(en.storageAllTitle)).toBeTruthy();
  });

  it("landing card badges the live sense state", async () => {
    apiMock.tweakStates.mockResolvedValue(tweakStates({ storage_sense: true }));
    apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
    apiMock.cleanupHistory.mockResolvedValue(cleanupHistory());
  apiMock.clockHour12.mockResolvedValue(false);
    render(
      React.createElement(ToolsView, {
        active: true,
        toolOpenId: null,
        onToolOpened: vi.fn(),
        onCleaningChange: vi.fn(),
      }),
    );
    // Good while holding, from the same landing read (zero new IPC)
    const card = screen.getByText(en.toolStorage).closest(".tool-card")!;
    await waitFor(() => {
      expect(card.querySelector(".tool-badge.ok")).toBeTruthy();
    });
    expect(card.querySelector(".tool-badge")?.textContent).toBe(en.checkOkBadge);
  });

  it("landing card warns while sense is off", async () => {
    apiMock.tweakStates.mockResolvedValue(tweakStates({ storage_sense: false }));
    apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
    apiMock.cleanupHistory.mockResolvedValue(cleanupHistory());
  apiMock.clockHour12.mockResolvedValue(false);
    render(
      React.createElement(ToolsView, {
        active: true,
        toolOpenId: null,
        onToolOpened: vi.fn(),
        onCleaningChange: vi.fn(),
      }),
    );
    const card = screen.getByText(en.toolStorage).closest(".tool-card")!;
    await waitFor(() => {
      expect(card.querySelector(".tool-badge.warn")).toBeTruthy();
    });
    expect(card.querySelector(".tool-badge")?.textContent).toBe(en.checkWarnBadge);
  });

  it("warns when sense is off, with the row as its attention", async () => {
    const user = userEvent.setup();
    apiMock.tweakStates.mockResolvedValue(tweakStates({ storage_sense: false }));
    apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
    apiMock.cleanupHistory.mockResolvedValue(cleanupHistory());
  apiMock.clockHour12.mockResolvedValue(false);
    render(
      React.createElement(ToolsView, {
        active: true,
        toolOpenId: null,
        onToolOpened: vi.fn(),
        onCleaningChange: vi.fn(),
      }),
    );
    await user.click(screen.getByText(en.toolStorage));
    await screen.findByText(en.tweakBannerNeeds(1));
    expect(screen.getByText(en.tweakBannerNeedsSub)).toBeTruthy();
    expect(document.querySelector(".health-banner.warn")).toBeTruthy();
    // general pattern even for one row: featured attention plus full
    // archive (the same deliberate repeat as gaming), banner above both.
    // ("Needs attention" also rides the row's own badge, so the title
    // is read off its section heading, not by bare text.)
    expect(document.querySelector("section .health-section-title")?.textContent).toBe(
      en.checkWarnBadge,
    );
    expect(screen.getByText(en.storageAllTitle)).toBeTruthy();
    expect(screen.getAllByText(en.tweakSsTitle)).toHaveLength(2);
  });
});
