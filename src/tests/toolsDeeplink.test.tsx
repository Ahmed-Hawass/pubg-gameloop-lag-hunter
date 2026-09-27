// tests/toolsDeeplink.test.tsx — the health-card deep-link contract:
// a row link opens the gaming page and rings the row, "pagefile" opens
// storage with the editor expanded, and a link to a row this machine
// lacks clears instead of re-firing on every visit.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

function openLinked(toolOpenId: string | null) {
  apiMock.tweakStates.mockResolvedValue(tweakStates());
  apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
  const onToolOpened = vi.fn();
  render(
    React.createElement(ToolsView, {
      active: true,
      toolOpenId,
      onToolOpened,
      onCleaningChange: vi.fn(),
    }),
  );
  return { onToolOpened };
}

describe("ToolsView deep-link", () => {
  it("a row link opens gaming and rings the row", async () => {
    openLinked("dvr");
    // DVR is off in the fixture, so it renders featured + archive: the
    // link rings the row in both places (same row, same ring)
    const titles = await screen.findAllByText(en.tweakDvrTitle);
    expect(titles).toHaveLength(2);
    await waitFor(() => {
      for (const title of titles) {
        expect(title.closest(".switch-row")!.classList.contains("is-linked")).toBe(true);
      }
    });
  });

  it('"pagefile" opens storage with the editor expanded', async () => {
    openLinked("pagefile");
    // the editor (not just the summary) is what the card promised
    await screen.findByText(en.tweakPfAutoLabel);
    const summary = screen
      .getByText(en.tweakPfTitle)
      .closest(".pf-summary")!;
    expect(summary.classList.contains("is-linked")).toBe(true);
  });

  it("a link to a missing row clears instead of nagging", async () => {
    const { onToolOpened } = openLinked("no_such_tweak");
    // routed to gaming (not the pagefile card), then cleared on the miss
    await screen.findAllByText(en.tweakDvrTitle);
    await waitFor(() => {
      expect(onToolOpened).toHaveBeenCalledOnce();
    });
  });
});
