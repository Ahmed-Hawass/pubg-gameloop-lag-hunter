// tests/about.test.tsx — the About update contract: a manual check that
// finds nothing says latest, one that finds a release hands it UP to the
// shell (never opening on stale data), and a failed check says so.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { AboutView } from "../views/AboutView";
import type { UpdateInfo } from "../bridge";

const apiMock = vi.hoisted(() => ({
  checkUpdate: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("../bridge", () => ({
  api: apiMock,
}));

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
}));

const release: UpdateInfo = {
  version: "9.9.9",
  notes: "notes",
  asset_url: "https://example.com/app.exe",
  asset_name: "app-9.9.9.exe",
  sums_url: "https://example.com/sums",
};

function open(updateInfo: UpdateInfo | null) {
  const onOpenUpdateModal = vi.fn();
  const onUpdateFound = vi.fn();
  render(
    React.createElement(AboutView, {
      updateInfo,
      version: "1.6.0",
      onOpenUpdateModal,
      onUpdateFound,
    }),
  );
  return { onOpenUpdateModal, onUpdateFound };
}

describe("AboutView updates", () => {
  it("a manual check with nothing new says latest, no modal", async () => {
    const user = userEvent.setup();
    apiMock.checkUpdate.mockResolvedValue(null);
    const { onOpenUpdateModal } = open(null);
    await user.click(screen.getByText(en.aboutCheckUpdate));
    await screen.findByText(en.aboutUpToDate);
    expect(onOpenUpdateModal).not.toHaveBeenCalled();
  });

  it("a found release goes up to the shell first, then opens the modal", async () => {
    const user = userEvent.setup();
    apiMock.checkUpdate.mockResolvedValue(release);
    const { onOpenUpdateModal, onUpdateFound } = open(null);
    await user.click(screen.getByText(en.aboutCheckUpdate));
    await waitFor(() => {
      // handed up BEFORE the modal opens: the modal must never read stale data
      expect(onUpdateFound).toHaveBeenCalledWith(release);
    });
    expect(onOpenUpdateModal).toHaveBeenCalledOnce();
  });

  it("a failed check says so and opens nothing", async () => {
    const user = userEvent.setup();
    apiMock.checkUpdate.mockRejectedValue("offline");
    const { onOpenUpdateModal } = open(null);
    await user.click(screen.getByText(en.aboutCheckUpdate));
    await screen.findByText(en.aboutUpdateErr);
    expect(onOpenUpdateModal).not.toHaveBeenCalled();
  });

  it("a startup-known release offers its download straight away", async () => {
    const user = userEvent.setup();
    const { onOpenUpdateModal } = open(release);
    await user.click(screen.getByText(new RegExp(`v${release.version}`)));
    expect(onOpenUpdateModal).toHaveBeenCalledOnce();
    expect(apiMock.checkUpdate).not.toHaveBeenCalled();
  });
});
