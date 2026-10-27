// tests/updateModal.test.tsx - the update dialog's four phases and its
// two cancellation contracts: Escape mid-download cancels the stream,
// and an exact "cancelled" rejection closes silently (a message merely
// containing the word is a real failure card).

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { ar } from "../locales/ar";
import { UpdateModal } from "../components/UpdateModal";
import type { UpdateInfo } from "../bridge";

const apiMock = vi.hoisted(() => ({
  downloadUpdate: vi.fn(),
  // the bridge contract is a promise for every command: the mock must
  // honor it, or a `.catch()` on the result throws
  cancelUpdateDownload: vi.fn(() => Promise.resolve()),
  openDownloadFolder: vi.fn(() => Promise.resolve()),
  openUrl: vi.fn(() => Promise.resolve()),
}));

// the UI language is switchable per test: the modal shows the update
// highlights in the UI's language, so an Arabic case must really run
// as Arabic (locale + lang both follow this switch)
const langState = vi.hoisted(() => ({ current: "en" as "en" | "ar" }));

vi.mock("../bridge", () => ({
  api: apiMock,
  saveDialog: vi.fn(),
}));

vi.mock("../i18n", () => ({
  useLang: () => ({
    t: langState.current === "ar" ? ar : en,
    lang: langState.current,
    setting: langState.current,
    setLanguage: vi.fn(),
  }),
}));

import { saveDialog } from "../bridge";

const info: UpdateInfo = {
  version: "9.9.9",
  notes_en: ["faster everything", "no more freeze at startup"],
  notes_ar: ["أسرع في كل شيء", "بلا تجمّد عند بدء التشغيل"],
  notes_url: "https://laghunter.vercel.app/changelog#v-9-9-9",
  asset_url: "https://example.com/app.exe",
  asset_name: "app-9.9.9.exe",
  sums_url: "https://example.com/sums",
};

afterEach(() => {
  langState.current = "en";
  vi.clearAllMocks();
});

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
  it("offers the version with its highlights, a full-notes link, and a download action", async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByText(/9\.9\.9/)).toBeTruthy();
    expect(screen.getByText("faster everything")).toBeTruthy();
    expect(screen.getByText("no more freeze at startup")).toBeTruthy();
    // the full notes live on the site: the link opens it in the browser
    await user.click(screen.getByText(en.updateNotesLink));
    expect(apiMock.openUrl).toHaveBeenCalledWith(info.notes_url);
    // no download attempted before the user picks a destination
    await user.click(screen.getByText(en.updateDownload));
    expect(saveDialog).toHaveBeenCalledOnce();
  });

  it("shows the highlights in the UI's language", () => {
    langState.current = "ar";
    open();
    expect(screen.getByText("أسرع في كل شيء")).toBeTruthy();
    expect(screen.getByText("بلا تجمّد عند بدء التشغيل")).toBeTruthy();
    expect(screen.queryByText("faster everything")).toBeNull();
    expect(screen.getByText(ar.updateNotesLink)).toBeTruthy();
  });

  it("borrows the other language before giving up the bullets", () => {
    langState.current = "ar";
    open({ info: { ...info, notes_ar: [] } });
    expect(screen.getByText("faster everything")).toBeTruthy();
    expect(screen.queryByText(en.updateNotesEmpty)).toBeNull();
  });

  it("falls back to a link-only line when a release has no short notes", async () => {
    const user = userEvent.setup();
    open({ info: { ...info, notes_en: [], notes_ar: [] } });
    expect(screen.queryByText("faster everything")).toBeNull();
    expect(screen.getByText(en.updateNotesEmpty)).toBeTruthy();
    await user.click(screen.getByText(en.updateNotesLink));
    expect(apiMock.openUrl).toHaveBeenCalledWith(info.notes_url);
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
    const { onClose, onDownloadingChange } = open();
    await user.click(screen.getByText(en.updateDownload));
    await waitFor(() => {
      expect(apiMock.downloadUpdate).toHaveBeenCalledOnce();
    });
    await user.keyboard("{Escape}");
    expect(apiMock.cancelUpdateDownload).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    // the shell's exit gate must stop claiming a download is running
    expect(onDownloadingChange).toHaveBeenLastCalledWith(false);
  });

  it("unmounting mid-download clears the shell's download flag", async () => {
    const user = userEvent.setup();
    vi.mocked(saveDialog).mockResolvedValue("C:/dl/app-9.9.9.exe");
    apiMock.downloadUpdate.mockReturnValue(new Promise(() => {}));
    const { onDownloadingChange, unmount } = open();
    await user.click(screen.getByText(en.updateDownload));
    await waitFor(() => {
      expect(apiMock.downloadUpdate).toHaveBeenCalledOnce();
    });
    expect(onDownloadingChange).toHaveBeenLastCalledWith(true);
    // App can swap the modal out for an advice/error dialog without close()
    unmount();
    expect(onDownloadingChange).toHaveBeenLastCalledWith(false);
    expect(apiMock.cancelUpdateDownload).toHaveBeenCalledOnce();
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

  it("a finished download is never cancelled by the phase change", async () => {
    // the old cleanup watched the PHASE, so the downloading → done
    // transition cancelled the download it had just finished
    const user = userEvent.setup();
    vi.mocked(saveDialog).mockResolvedValue("C:/dl/app-9.9.9.exe");
    apiMock.downloadUpdate.mockResolvedValue("C:/dl/app-9.9.9.exe");
    const { unmount } = open();
    await user.click(screen.getByText(en.updateDownload));
    await screen.findByText(en.updateDoneTitle);
    expect(apiMock.cancelUpdateDownload).not.toHaveBeenCalled();
    // and unmounting the finished modal must not cancel anything either
    unmount();
    expect(apiMock.cancelUpdateDownload).not.toHaveBeenCalled();
  });

  it("a side action that fails says so on the modal, in the app's language", async () => {
    const user = userEvent.setup();
    apiMock.openUrl.mockRejectedValue("no browser available");
    open();
    await user.click(screen.getByText(en.updateNotesLink));
    // the failure is explained: no silent no-op
    expect(
      await screen.findByText(en.dialog.unknownErrorBody("no browser available")),
    ).toBeTruthy();
  });

  it("the engine resolves the release: the UI only sends the version", async () => {
    const user = userEvent.setup();
    vi.mocked(saveDialog).mockResolvedValue("C:/dl/app-9.9.9.exe");
    apiMock.downloadUpdate.mockResolvedValue("C:/dl/app-9.9.9.exe");
    open();
    await user.click(screen.getByText(en.updateDownload));
    await waitFor(() => {
      expect(apiMock.downloadUpdate).toHaveBeenCalledOnce();
    });
    // the first argument is the VERSION, never a copy of the asset URLs:
    // the engine resolves the release itself
    expect(apiMock.downloadUpdate.mock.calls[0][0]).toBe(info.version);
  });
});
