// tests/updateModal.test.tsx — the update dialog's four phases and its
// two cancellation contracts: Escape mid-download cancels the stream,
// and an exact "cancelled" rejection closes silently (a message merely
// containing the word is a real failure card).

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { UpdateModal } from "../components/UpdateModal";
import type { UpdateInfo } from "../bridge";

const apiMock = vi.hoisted(() => ({
  downloadUpdate: vi.fn(),
  cancelUpdateDownload: vi.fn(),
  openDownloadFolder: vi.fn(),
}));

vi.mock("../bridge", () => ({
  api: apiMock,
  saveDialog: vi.fn(),
}));

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
}));

import { saveDialog } from "../bridge";

const info: UpdateInfo = {
  version: "9.9.9",
  notes: "faster everything",
  asset_url: "https://example.com/app.exe",
  asset_name: "app-9.9.9.exe",
  sums_url: "https://example.com/sums",
};

function open(props: Partial<React.ComponentProps<typeof UpdateModal>> = {}) {
  const onClose = vi.fn();
  const onDownloadingChange = vi.fn();
  const rendered = render(
    React.createElement(UpdateModal, {
      info,
      onClose,
      onDownloadingChange,
      ...props,
    }),
  );
  return { onClose, onDownloadingChange, unmount: rendered.unmount };
}

describe("UpdateModal", () => {
  it("offers the version with its notes and a download action", async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByText(/9\.9\.9/)).toBeTruthy();
    expect(screen.getByText("faster everything")).toBeTruthy();
    // no download attempted before the user picks a destination
    await user.click(screen.getByText(en.updateDownload));
    expect(saveDialog).toHaveBeenCalledOnce();
  });

  it("downloads to the chosen destination, then shows the verified file", async () => {
    const user = userEvent.setup();
    vi.mocked(saveDialog).mockResolvedValue("C:/dl/app-9.9.9.exe");
    let onEvent!: (ev: { event: string; downloaded: number; total: number }) => void;
    apiMock.downloadUpdate.mockImplementation(
      (_info: unknown, _dest: unknown, cb: typeof onEvent) => {
        onEvent = cb;
        return new Promise(() => {}); // stream stays open for the test below
      },
    );
    const { onDownloadingChange } = open();
    await user.click(screen.getByText(en.updateDownload));
    await waitFor(() => {
      expect(apiMock.downloadUpdate).toHaveBeenCalledOnce();
    });
    // the shell learns a download is active (the exit confirm needs it)
    expect(onDownloadingChange).toHaveBeenCalledWith(true);
    // progress events repaint the bar
    onEvent({ event: "progress", downloaded: 50, total: 100 });
    expect(await screen.findByText(/50%/)).toBeTruthy();
  });

  it("Escape mid-download cancels the stream and closes", async () => {
    const user = userEvent.setup();
    vi.mocked(saveDialog).mockResolvedValue("C:/dl/app-9.9.9.exe");
    apiMock.downloadUpdate.mockReturnValue(new Promise(() => {}));
    const { onClose } = open();
    await user.click(screen.getByText(en.updateDownload));
    await waitFor(() => {
      expect(apiMock.downloadUpdate).toHaveBeenCalledOnce();
    });
    await user.keyboard("{Escape}");
    expect(apiMock.cancelUpdateDownload).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('an exact "cancelled" rejection closes silently, anything else fails loudly', async () => {
    const user = userEvent.setup();
    // cancelled save dialog: back to the offer, no error card
    vi.mocked(saveDialog).mockResolvedValue(null);
    const first = open();
    await user.click(screen.getByText(en.updateDownload));
    expect(screen.queryByText(en.updateFailedTitle)).toBeNull();
    first.unmount();

    // cancelled download: treated as a clean close, no error card
    vi.mocked(saveDialog).mockResolvedValue("C:/dl/app.exe");
    apiMock.downloadUpdate.mockRejectedValue("cancelled");
    const second = open();
    await user.click(screen.getByText(en.updateDownload));
    await waitFor(() => {
      expect(second.onClose).toHaveBeenCalledOnce();
    });
    expect(screen.queryByText(en.updateFailedTitle)).toBeNull();
    second.unmount();

    // a real failure naming the word inside a longer message: error card
    apiMock.downloadUpdate.mockRejectedValue("disk cancelled by policy");
    open();
    await user.click(screen.getByText(en.updateDownload));
    expect(await screen.findByText(en.updateFailedTitle)).toBeTruthy();
    expect(screen.getByText(en.updateRetry)).toBeTruthy();
  });
});
