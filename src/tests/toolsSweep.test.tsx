// tests/toolsSweep.test.tsx — the storage sweep contract: the page opens
// under a plain header (title plus desc, like backup memory), scan first
// (never on open), category names come from machine-key records, only
// non-empty places auto-tick, zero/unreadable rows are muted and never
// cleaned, and Clean deletes exactly the ticked ids.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { ToolsView } from "../views/ToolsView";
import { cleanupScan, pagefileSettings, tweakStates } from "./fixtures";

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

async function openSweep(user: ReturnType<typeof userEvent.setup>) {
  apiMock.tweakStates.mockResolvedValue(tweakStates());
  apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
  render(
    React.createElement(ToolsView, {
      active: true,
      toolOpenId: null,
      onToolOpened: vi.fn(),
      onCleaningChange: vi.fn(),
    }),
  );
  await user.click(screen.getByText(en.toolCleanup));
  // the page opens on the idle hero (no collapse, no read to wait for)
  await screen.findByText(en.cleanupTitle);
  expect(apiMock.storageScan).not.toHaveBeenCalled();
}

describe("ToolsView storage sweep", () => {
  it("scans on demand and auto-ticks only measured places", async () => {
    const user = userEvent.setup();
    apiMock.storageScan.mockResolvedValue(cleanupScan());
    await openSweep(user);
    await user.click(screen.getByText(en.cleanupScan));
    // machine keys translated, never raw ids
    await screen.findByText(en.cleanupCatUserTemp);
    expect(screen.queryByText("user_temp")).toBeNull();
    const ticked = screen.getByRole("checkbox", { name: en.cleanupCatUserTemp });
    expect(ticked).toBeChecked();
    // zero and unreadable rows stay visible but muted and unticked
    const zero = screen.getByRole("checkbox", { name: en.cleanupCatSystemTemp });
    expect(zero).not.toBeChecked();
    expect(zero).toBeDisabled();
    const unknown = screen.getByRole("checkbox", { name: en.cleanupCatRecycle });
    expect(unknown).not.toBeChecked();
    expect(unknown).toBeDisabled();
  });

  it("cleans exactly the ticked ids after confirming", async () => {
    const user = userEvent.setup();
    apiMock.storageScan.mockResolvedValue(cleanupScan());
    apiMock.storageClean.mockResolvedValue([
      { id: "user_temp", freed_bytes: 10485760 },
    ]);
    await openSweep(user);
    await user.click(screen.getByText(en.cleanupScan));
    await screen.findByText(en.cleanupCatUserTemp);
    await user.click(screen.getByText(en.cleanupClean));
    // the confirm names the ticked places, like a delete confirm
    await screen.findByText(en.cleanupConfirmTitle);
    await user.click(
      within(screen.getByText(en.cleanupConfirmTitle).closest(".dialog-box")!).getByText(
        en.cleanupClean,
      ),
    );
    await waitFor(() => {
      expect(apiMock.storageClean).toHaveBeenCalledOnce();
    });
    expect(apiMock.storageClean.mock.calls[0][0]).toEqual(["user_temp"]);
    // the payoff is a measured number, never an estimate
    expect(await screen.findByText(en.cleanupFreed(10))).toBeTruthy();
  });

  it("idle invites, scanned shows hero plus breakdown, cleaned celebrates", async () => {
    const user = userEvent.setup();
    apiMock.storageScan.mockResolvedValue(cleanupScan());
    apiMock.storageClean.mockResolvedValue([
      { id: "user_temp", freed_bytes: 10485760 },
    ]);
    await openSweep(user);
    // idle: hero with the mode pills, no list yet
    expect(screen.getByText(en.cleanupTitle)).toBeTruthy();
    expect(document.querySelector(".cleanup-list")).toBeNull();
    // scanned: selected hero plus one bar segment per measured place
    await user.click(screen.getByText(en.cleanupScan));
    await screen.findByText(en.cleanupReadyToFree);
    const bars = document.querySelectorAll(".cleanup-bars > span");
    expect(bars).toHaveLength(1);
    expect(
      document.querySelector(".cleanup-row .cleanup-dot"),
    ).toBeTruthy();
    // cleaned: payoff hero with a way back, list gone until rescan
    await user.click(screen.getByText(en.cleanupClean));
    await user.click(
      within(screen.getByText(en.cleanupConfirmTitle).closest(".dialog-box")!).getByText(
        en.cleanupClean,
      ),
    );
    await screen.findByText(en.cleanupCleanedTag);
    expect(document.querySelector(".cleanup-list")).toBeNull();
    await user.click(screen.getByText(en.cleanupRescan));
    await screen.findByText(en.cleanupReadyToFree);
  });

  it("opens under a plain page header with title and desc", async () => {
    const user = userEvent.setup();
    await openSweep(user);
    // the cleanup page carries the same plain header as backup memory
    // (title plus desc line, never a boxed accordion)
    const head = document.querySelector(".page-head")!;
    expect(head.querySelector(".page-head-title")?.textContent).toBe(
      en.toolCleanup,
    );
    expect(head.querySelector(".page-head-desc")?.textContent).toBe(
      en.toolCleanupDesc,
    );
  });
});
