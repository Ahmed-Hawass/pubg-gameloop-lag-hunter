// tests/system.test.tsx - the rig page contract: spec cards with honest
// placeholders, storage and device rows, and a copy-all button whose
// sheet reuses the exact on-screen strings (pinned, not hand-copied).

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { specSheet, SystemView } from "../views/SystemView";
import type { SystemInfo } from "../bridge";
import { settings } from "./fixtures";

const apiMock = vi.hoisted(() => ({
  systemInfo: vi.fn(),
  getSettings: vi.fn(),
  dismissIntroCard: vi.fn(),
}));

// the page intro reads settings on mount: default to a fresh machine
// (the card shows) unless a test overrides the dismissed list below
apiMock.getSettings.mockResolvedValue(settings());
apiMock.dismissIntroCard.mockResolvedValue(undefined);

vi.mock("../bridge", () => ({
  api: apiMock,
}));

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
}));

const info: SystemInfo = {
  cpu: { name: "Intel(R) Core(TM) i7-6820HQ CPU @ 2.70GHz", max_mhz: 2700, cores: 8, threads: 16 },
  gpus: [{ name: "NVIDIA Quadro M2000M", vram_gb: 4, driver: "31.0.15.3645" }],
  ram: { total_gb: 31.9, mem_type: "DDR3", speed_mhz: 2400 },
  disks: [
    { name: "Samsung SSD 970 EVO Plus", media: "SSD", bus: "NVMe", size_gb: 500, free_gb: 286 },
  ],
  display: { width: 1920, height: 1080, refresh_hz: 60, scale_pct: 100 },
  system: {
    manufacturer: "Dell",
    model: "Precision 7510",
    os_caption: "Windows 11 Pro",
    os_release: "25H2",
    directx: "DirectX 12",
  },
  ram_gb: 31.9,
  gpu_counters: true,
  powershell_available: true,
};

describe("SystemView", () => {
  it("renders spec cards, storage, device rows and copies the sheet", async () => {
    const user = userEvent.setup();
    apiMock.systemInfo.mockResolvedValue(info);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(React.createElement(SystemView));
    await screen.findByText("Intel Core i7-6820HQ");
    // headline numbers first, labels second (never raw backend English)
    expect(screen.getByText("2.70 GHz")).toBeTruthy();
    expect(screen.getByText("8 cores · 16 threads")).toBeTruthy();
    expect(screen.getByText("60 Hz")).toBeTruthy();
    expect(screen.getByText("1920x1080")).toBeTruthy();
    expect(screen.getByText("Speed: 2400 MHz")).toBeTruthy();
    expect(screen.getByText("Scale: 100%")).toBeTruthy();
    expect(screen.getByText("32 GB")).toBeTruthy();
    expect(screen.getByText("NVMe · 500 GB · 286 GB free")).toBeTruthy();
    expect(screen.getByText("43% used")).toBeTruthy();
    expect(screen.getByText("Dell Precision 7510")).toBeTruthy();
    expect(screen.getByText("Windows 11 Pro 25H2")).toBeTruthy();
    // the copy sheet is the same strings, pinned by the shared builder
    await user.click(screen.getByText(en.copySpecs));
    expect(writeText).toHaveBeenCalledOnce();
    const sheet = writeText.mock.calls[0][0] as string;
    expect(sheet).toBe(specSheet(info, en));
    expect(sheet).toContain("Intel Core i7-6820HQ");
    await screen.findByText(en.copiedSpecs);
  });

  it("the copied flash timer is cleared on unmount", async () => {
    apiMock.systemInfo.mockResolvedValue(info);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    vi.useFakeTimers();
    try {
      const { unmount } = render(React.createElement(SystemView));
      await act(async () => {});
      fireEvent.click(screen.getByText(en.copySpecs));
      await act(async () => {});
      expect(screen.getByText(en.copiedSpecs)).toBeTruthy();
      expect(vi.getTimerCount()).toBe(1);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("missing values render honest placeholders, never blanks or guesses", async () => {
    apiMock.systemInfo.mockResolvedValue({
      ...info,
      cpu: { name: "", max_mhz: null, cores: null, threads: null },
      gpus: [],
      ram: { total_gb: 0, mem_type: null, speed_mhz: null },
      display: { width: null, height: null, refresh_hz: null, scale_pct: null },
      disks: [],
    });
    render(React.createElement(SystemView));
    await screen.findByText(en.yourRig);
    // every missing slot shows the placeholder (cards, display, disks)
    const dashes = screen.getAllByText("--");
    expect(dashes.length).toBeGreaterThan(3);
  });

  it("shows a one-shot intro under a standing header until X persists it away", async () => {
    const user = userEvent.setup();
    apiMock.systemInfo.mockResolvedValue(info);
    render(React.createElement(SystemView));
    // the header names the place from the first paint (it never waits
    // on the card), the card explains it once below the header
    const head = document.querySelector(".page-head");
    expect(head?.textContent).toContain(en.system);
    expect(head?.textContent).toContain(en.systemScope);
    await screen.findByText(en.introSystemTitle);
    expect(screen.getByText(en.introSystemBody)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: en.dialog.dismiss }));
    await waitFor(() => {
      expect(apiMock.dismissIntroCard).toHaveBeenCalledWith("system");
    });
    // the card leaves, the standing header stays
    expect(document.querySelector(".intro-card")).toBeNull();
    expect(document.querySelector(".page-head")?.textContent).toContain(en.system);
  });
});
