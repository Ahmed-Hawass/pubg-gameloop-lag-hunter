// tests/system.test.tsx — the rig page contract: spec cards with honest
// placeholders, storage and device rows, and a copy-all button whose
// sheet reuses the exact on-screen strings (pinned, not hand-copied).

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { specSheet, SystemView } from "../views/SystemView";
import type { SystemInfo } from "../bridge";

const apiMock = vi.hoisted(() => ({
  systemInfo: vi.fn(),
}));

vi.mock("../bridge", () => ({
  api: apiMock,
}));

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
}));

const info: SystemInfo = {
  cpu: { name: "Core i7-6820HQ", mhz: 2700, cores: 4, threads: 8 },
  gpus: [{ name: "Quadro M2000M", vram_gb: 4, driver: "31.0.15.3645" }],
  ram: { total_gb: 31.9, mem_type: "DDR3", speed_mhz: 2400 },
  disks: [
    { name: "MTFDHBA512QFD-1AX1AABHA", media: "SSD", bus: "NVMe", size_gb: 477 },
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
    await screen.findByText("Core i7-6820HQ");
    // spec lines compose from numbers, never raw backend English
    expect(screen.getByText("2.70 GHz base")).toBeTruthy();
    expect(screen.getByText("1920x1080")).toBeTruthy();
    expect(screen.getByText("Dell Precision 7510")).toBeTruthy();
    // the copy sheet is the same strings, pinned by the shared builder
    await user.click(screen.getByText(en.copySpecs));
    expect(writeText).toHaveBeenCalledOnce();
    const sheet = writeText.mock.calls[0][0] as string;
    expect(sheet).toBe(specSheet(info, en));
    expect(sheet).toContain("Core i7-6820HQ");
    await screen.findByText(en.copiedSpecs);
  });

  it("missing values render honest placeholders, never blanks or guesses", async () => {
    apiMock.systemInfo.mockResolvedValue({
      ...info,
      cpu: { name: "", mhz: null, cores: null, threads: null },
      gpus: [],
      display: { width: null, height: null, refresh_hz: null, scale_pct: null },
      disks: [],
    });
    render(React.createElement(SystemView));
    await screen.findByText(en.yourRig);
    // every missing slot shows the placeholder (cards, display, disks)
    const dashes = screen.getAllByText("--");
    expect(dashes.length).toBeGreaterThan(3);
  });
});
