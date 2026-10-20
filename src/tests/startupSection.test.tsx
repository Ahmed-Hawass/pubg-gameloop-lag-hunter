// tests/startupSection.test.tsx — the startup programs contract: rows
// mirror the live registry read with Task Manager wording (one state
// button per row: its text is the state, its accessible name the
// action), enabling names the program and its cost first (the additive
// direction), disabling stays direct, locked rows offer the shield path
// (one system prompt, silent rollback on dismiss), and the UI always
// paints the re-read truth (never its own guess).

import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { StartupSection } from "../views/StartupSection";
import type { StartupEntry } from "../bridge";
import { settings } from "./fixtures";

const apiMock = vi.hoisted(() => ({
  startupEntries: vi.fn(),
  setStartupEnabled: vi.fn(),
  setStartupEnabledAdmin: vi.fn(),
  getSettings: vi.fn(),
  dismissIntroCard: vi.fn(),
}));

// page intros read settings on mount: default to a fresh machine (every
// card shows) unless a test overrides the dismissed list below
apiMock.getSettings.mockResolvedValue(settings());
apiMock.dismissIntroCard.mockResolvedValue(undefined);

vi.mock("../bridge", () => ({
  api: apiMock,
}));

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
}));

function entry(over: Partial<StartupEntry> = {}): StartupEntry {
  return {
    id: "user:Discord",
    name: "Discord",
    enabled: true,
    locked: false,
    icon_url: null,
    ...over,
  };
}

function open() {
  render(React.createElement(StartupSection, { active: true }));
}

describe("StartupSection", () => {
  it("rows show the program, its state, and its action", async () => {
    apiMock.startupEntries.mockResolvedValue([
      entry(),
      entry({ id: "machine:Vendor", name: "Vendor", enabled: false }),
    ]);
    open();
    await screen.findByText("Discord");
    await screen.findByText("Vendor");
    // the button text names the state, its accessible name the action
    expect(screen.getByText(en.startupStateOn)).toBeTruthy();
    expect(screen.getByText(en.startupStateOff)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: `${en.startupDisable} Discord` }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: `${en.startupEnable} Vendor` }),
    ).toBeTruthy();
    // rows carry no (?) hint buttons anywhere
    expect(screen.queryByRole("button", { name: /About / })).toBeNull();
  });

  it("window focus re-reads only while the tab is visible", async () => {
    apiMock.startupEntries.mockResolvedValue([entry()]);
    const { rerender } = render(
      React.createElement(StartupSection, { active: false }),
    );
    await screen.findByText("Discord");
    apiMock.startupEntries.mockClear();
    // a hidden tab stays quiet on every window focus
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(apiMock.startupEntries).not.toHaveBeenCalled();
    // the visible tab arms the same listener
    rerender(React.createElement(StartupSection, { active: true }));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => {
      expect(apiMock.startupEntries).toHaveBeenCalledOnce();
    });
  });

  it("enabling names the program and its cost first, then flips on confirm", async () => {
    const user = userEvent.setup();
    apiMock.startupEntries.mockResolvedValue([entry({ enabled: false })]);
    const flipped = [entry({ enabled: true })];
    apiMock.setStartupEnabled.mockResolvedValue(flipped);
    open();
    await screen.findByText("Discord");
    await user.click(screen.getByRole("button", { name: `${en.startupEnable} Discord` }));
    // confirm names the program and its cost before anything runs
    await screen.findByText(en.startupEnableConfirmTitle);
    expect(screen.getByText(en.startupEnableConfirmBody("Discord"))).toBeTruthy();
    // the row action ("Enable Discord") and the confirm ("Enable") share
    // a word: the exact accessible name picks the confirm
    await user.click(screen.getByRole("button", { name: en.startupEnable }));
    await waitFor(() => {
      expect(apiMock.setStartupEnabled).toHaveBeenCalledWith("user:Discord", true);
    });
    // the UI paints the verified answer, so the button text follows it
    await waitFor(() => {
      expect(screen.getByText(en.startupStateOn)).toBeTruthy();
    });
  });

  it("disabling is direct with no confirm", async () => {
    const user = userEvent.setup();
    apiMock.startupEntries.mockResolvedValue([entry({ enabled: true })]);
    apiMock.setStartupEnabled.mockResolvedValue([entry({ enabled: false })]);
    open();
    await screen.findByText("Discord");
    await user.click(screen.getByRole("button", { name: `${en.startupDisable} Discord` }));
    await waitFor(() => {
      expect(apiMock.setStartupEnabled).toHaveBeenCalledWith("user:Discord", false);
    });
    // turning off is the safe direction: no dialog on the way
    expect(screen.queryByText(en.startupEnableConfirmTitle)).toBeNull();
  });

  it("a locked-on row flips off through one system prompt, no app confirm", async () => {
    const user = userEvent.setup();
    apiMock.startupEntries.mockResolvedValue([
      entry({ id: "machine:Locked", name: "Locked", enabled: true, locked: true }),
    ]);
    apiMock.setStartupEnabled.mockClear();
    apiMock.setStartupEnabledAdmin.mockClear();
    apiMock.setStartupEnabledAdmin.mockResolvedValue([
      entry({ id: "machine:Locked", name: "Locked", enabled: false, locked: false }),
    ]);
    open();
    await screen.findByText("Locked");
    await screen.findByText(en.startupLockedReason);
    // the state stays on the button, the shield action in its name
    const btn = screen.getByRole("button", {
      name: `${en.startupDisable} Locked (${en.startupChangeAsAdmin})`,
    });
    expect(btn).not.toBeDisabled();
    expect(btn.textContent).toContain(en.startupStateOn);
    // the shield rides beside the name, never inside the button
    expect(btn.querySelector("svg")).toBeNull();
    const nameEl = screen.getByText("Locked");
    expect(nameEl.parentElement?.querySelector("svg")).not.toBeNull();
    // turning off is direct (the system prompt is the consent)
    await user.click(btn);
    await waitFor(() => {
      expect(apiMock.setStartupEnabledAdmin).toHaveBeenCalledWith("machine:Locked", false);
    });
    // no app confirm on the way, and the normal path never fires
    expect(screen.queryByText(en.startupEnableConfirmTitle)).toBeNull();
    expect(apiMock.setStartupEnabled).not.toHaveBeenCalled();
  });

  it("a locked-off row names the program before flipping on", async () => {
    const user = userEvent.setup();
    apiMock.startupEntries.mockResolvedValue([
      entry({ id: "machine:D", name: "D", enabled: false, locked: true }),
    ]);
    apiMock.setStartupEnabledAdmin.mockClear();
    apiMock.setStartupEnabledAdmin.mockResolvedValue([
      entry({ id: "machine:D", name: "D", enabled: true, locked: false }),
    ]);
    open();
    await screen.findByText("D");
    // turning on names the program first, like every enable
    await user.click(
      screen.getByRole("button", {
        name: `${en.startupEnable} D (${en.startupChangeAsAdmin})`,
      }),
    );
    await screen.findByText(en.startupEnableConfirmTitle);
    expect(screen.getByText(en.startupEnableConfirmBody("D"))).toBeTruthy();
    await user.click(screen.getByRole("button", { name: en.startupEnable }));
    await waitFor(() => {
      expect(apiMock.setStartupEnabledAdmin).toHaveBeenCalledWith("machine:D", true);
    });
  });

  it('a dismissed system prompt ("cancelled") rolls back silently', async () => {
    const user = userEvent.setup();
    apiMock.startupEntries.mockClear();
    apiMock.startupEntries.mockResolvedValue([
      entry({ id: "machine:D", name: "D", enabled: false, locked: true }),
    ]);
    apiMock.setStartupEnabledAdmin.mockClear();
    apiMock.setStartupEnabledAdmin.mockRejectedValue("cancelled");
    open();
    await screen.findByText("D");
    await user.click(
      screen.getByRole("button", {
        name: `${en.startupEnable} D (${en.startupChangeAsAdmin})`,
      }),
    );
    await screen.findByText(en.startupEnableConfirmTitle);
    await user.click(screen.getByRole("button", { name: en.startupEnable }));
    // the truth is repainted (one silent re-read) with no dialog
    await waitFor(() => {
      expect(apiMock.startupEntries).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText(en.dialog.somethingWrong)).toBeNull();
  });

  it("a failed read is an honest error panel, never a guessed list", async () => {
    apiMock.startupEntries.mockRejectedValue("boom");
    open();
    await screen.findByText(en.dialog.somethingWrong);
  });

  it("an empty box lists nothing with its own line", async () => {
    apiMock.startupEntries.mockResolvedValue([]);
    open();
    await screen.findByText(en.startupEmpty);
  });
});
