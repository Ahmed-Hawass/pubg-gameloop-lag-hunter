// tests/toolsSweep.test.tsx — the storage sweep contract: scan first
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
  await user.click(screen.getByText(en.toolStorage));
  // expand the sweep section (its summary is static, no read to wait for)
  await user.click(await screen.findByText(en.cleanupTitle));
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
});
