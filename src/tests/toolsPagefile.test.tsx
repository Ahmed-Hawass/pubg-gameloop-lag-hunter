// tests/toolsPagefile.test.tsx — the page file editor contract: a failed
// read shows an inline honest error (never a guessed editor), and a custom
// request passes through validate (warning pauses on a confirm) before the
// write, which ends in a one-time reboot offer.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

async function openPagefile(user: ReturnType<typeof userEvent.setup>) {
  apiMock.tweakStates.mockResolvedValue(tweakStates());
  render(
    React.createElement(ToolsView, {
      active: true,
      toolOpenId: null,
      onToolOpened: vi.fn(),
      onCleaningChange: vi.fn(),
    }),
  );
  await user.click(screen.getByText(en.toolPagefile));
}

describe("ToolsView page file editor", () => {
  it("a failed read shows an inline error, never a guessed editor", async () => {
    const user = userEvent.setup();
    apiMock.pagefileSettings.mockRejectedValue("PF_READ_FAILED");
    await openPagefile(user);
    await screen.findByText(en.errors.PF_READ_FAILED);
    // no drive rows, no apply button: nothing guessed
    expect(screen.queryByText(en.tweakPfApply)).toBeNull();
  });

  it("custom sizes warn, confirm, write, then offer one reboot", async () => {
    const user = userEvent.setup();
    apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
    apiMock.validatePagefileSettings.mockResolvedValue("small");
    apiMock.applyPagefileSettings.mockResolvedValue({
      id: "pagefile-settings",
      previous: null,
      value: 1,
      verified: true,
    });
    await openPagefile(user);
    // expand the editor from its summary row (async read lands first)
    await user.click(await screen.findByText(en.tweakPfTitle));
    await screen.findByText(en.tweakPfAutoLabel);
    // switch the C: drive to custom sizes
    await user.click(screen.getByText(en.tweakPfModeCustom));
    const min = screen.getByLabelText(en.tweakPfMinLabel);
    const max = screen.getByLabelText(en.tweakPfMaxLabel);
    await user.clear(min);
    await user.type(min, "2048");
    await user.clear(max);
    await user.type(max, "4096");
    // the request changed: Apply arms, validate pauses on the warning
    await user.click(screen.getByText(en.tweakPfApply));
    await waitFor(() => {
      expect(apiMock.validatePagefileSettings).toHaveBeenCalledWith(
        false,
        "C:",
        "custom",
        "2048",
        "4096",
      );
    });
    await screen.findByText(en.tweakPfWarnSmallTitle);
    // confirming writes once, then offers exactly one reboot
    await user.click(
      within(screen.getByText(en.tweakPfWarnSmallTitle).closest(".dialog-box")!).getByText(
        en.tweakPfApply,
      ),
    );
    await waitFor(() => {
      expect(apiMock.applyPagefileSettings).toHaveBeenCalledOnce();
    });
    await screen.findByText(en.rebootTitle);
    await user.click(screen.getByText(en.rebootLater));
    expect(screen.queryByText(en.rebootTitle)).toBeNull();
    expect(apiMock.scheduleReboot).not.toHaveBeenCalled();
  });

  it("landing badge agrees with the editor verdict", async () => {
    const user = userEvent.setup();
    apiMock.tweakStates.mockResolvedValue(tweakStates());
    // C: system-managed reads healthy: the card says Good…
    apiMock.pagefileSettings.mockResolvedValue(pagefileSettings());
    render(
      React.createElement(ToolsView, {
        active: true,
        toolOpenId: null,
        onToolOpened: vi.fn(),
        onCleaningChange: vi.fn(),
      }),
    );
    await screen.findByText(en.checkOkBadge);
    // …and the editor behind it paints the same ok state (expanded
    // from its summary row, like the details test above)
    await user.click(screen.getByText(en.toolPagefile));
    await user.click(await screen.findByText(en.tweakPfTitle));
    await screen.findByText(en.tweakPfAutoLabel);
    // all-off reads warn on both faces (one shared rule, never drifted)
    apiMock.pagefileSettings.mockResolvedValue(
      pagefileSettings({
        automatic: false,
        drives: [{ drive: "C:", free_mb: 50000, mode: "off", min_mb: null, max_mb: null }],
      }),
    );
    render(
      React.createElement(ToolsView, {
        active: true,
        toolOpenId: null,
        onToolOpened: vi.fn(),
        onCleaningChange: vi.fn(),
      }),
    );
    await screen.findByText(en.checkWarnBadge);
  });
});
