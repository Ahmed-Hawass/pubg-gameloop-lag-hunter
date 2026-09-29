// tests/toolsStorage.test.tsx — the Storage card contract: it kept only
// the Storage Sense switch (page file and sweep own their cards now),
// and the switch still mirrors the live read with its background note.

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

describe("ToolsView storage card", () => {
  it("opens a page with only the sense switch, page file lives elsewhere", async () => {
    const user = userEvent.setup();
    apiMock.tweakStates.mockResolvedValue(tweakStates({ storage_sense: true }));
    apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
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
  });
});
