// tests/processes.test.tsx — the processes contract: a totals header
// that never understates (every background process counts, not just the
// displayed rows), then user apps versus system tasks from the engine's
// own grouping (never guessed in the UI).

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { ProcessesView } from "../views/ProcessesView";
import type { TopProcesses } from "../bridge";
import { INTRO_CARDS_EVENT } from "../useIntroCard";
import { settings } from "./fixtures";

const apiMock = vi.hoisted(() => ({
  topProcesses: vi.fn(),
  getSettings: vi.fn(),
  dismissIntroCard: vi.fn(),
}));

vi.mock("../bridge", () => ({
  api: apiMock,
}));

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
}));

const answer: TopProcesses = {
  processes: [
    { name: "chrome", pid: 1, cpu_pct: 9.8, ram_mb: 287, kind: "app", display_key: null, display_name: "chrome" },
    { name: "code", pid: 2, cpu_pct: 1.0, ram_mb: 287, kind: "app", display_key: null, display_name: "code" },
    { name: "svchost", pid: 3, cpu_pct: 0.5, ram_mb: 79, kind: "system", display_key: null, display_name: "svchost" },
  ],
  total_cpu: 13.7,
  total_ram_mb: 546,
};

describe("ProcessesView", () => {
  it("shows honest totals plus the two groups", async () => {
    apiMock.topProcesses.mockResolvedValue(answer);
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ProcessesView, { active: false }));
    // totals come from the answer, not from summing the visible rows
    await screen.findByText("13.7%");
    expect(screen.getByText("546 MB")).toBeTruthy();
    // groups by engine kind, each with its guidance
    expect(screen.getByText(en.groupAppsTitle)).toBeTruthy();
    expect(screen.getByText(en.groupAppsHint)).toBeTruthy();
    expect(screen.getByText(en.groupSystemTitle)).toBeTruthy();
    expect(screen.getByText(en.groupSystemHint)).toBeTruthy();
    expect(screen.getByText("chrome")).toBeTruthy();
    expect(screen.getByText("svchost")).toBeTruthy();
  });

  it("hides empty groups instead of dead headers", async () => {
    apiMock.topProcesses.mockResolvedValue({
      processes: [
        { name: "dwm", pid: 9, cpu_pct: 2.0, ram_mb: 100, kind: "system", display_key: "procDwm", display_name: "dwm" },
      ],
      total_cpu: 2.0,
      total_ram_mb: 100,
    });
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ProcessesView, { active: false }));
    await screen.findByText(en.groupSystemTitle);
    expect(screen.queryByText(en.groupAppsTitle)).toBeNull();
  });

  it("manual refresh forces a fresh read with a spinner", async () => {
    const user = userEvent.setup();
    apiMock.topProcesses.mockResolvedValue(answer);
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ProcessesView, { active: false }));
    await screen.findByText("chrome");
    apiMock.topProcesses.mockClear();
    await user.click(screen.getByText(en.refresh));
    expect(apiMock.topProcesses).toHaveBeenCalledWith(true);
  });

  it("curated staples translate, everything else shows verbatim", async () => {    apiMock.topProcesses.mockResolvedValue({
      processes: [
        { name: "powershell", pid: 1, cpu_pct: 5.0, ram_mb: 50, kind: "system", display_key: "procPowershell", display_name: "powershell" },
        { name: "brave", pid: 2, cpu_pct: 4.0, ram_mb: 400, kind: "app", display_key: null, display_name: "Brave" },
      ],
      total_cpu: 9.0,
      total_ram_mb: 450,
    });
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ProcessesView, { active: false }));
    // translated by key, never the raw stem
    expect(await screen.findByText(en.procNames.procPowershell)).toBeTruthy();
    expect(screen.queryByText("powershell")).toBeNull();
    // ProductName verbatim, no invention
    expect(screen.getByText("Brave")).toBeTruthy();
  });

  it("shows a one-shot intro card until X persists it away", async () => {
    const user = userEvent.setup();
    apiMock.topProcesses.mockResolvedValue(answer);
    apiMock.getSettings.mockResolvedValue(settings());
    apiMock.dismissIntroCard.mockResolvedValue(undefined);
    render(React.createElement(ProcessesView, { active: false }));
    // new user: the page card explains totals, groups, and refresh
    await screen.findByText(en.introProcessesTitle);
    expect(screen.getByText(en.introProcessesBody)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: en.dialog.dismiss }));
    // optimistic hide plus one persisted dismissal by card id
    await waitFor(() => {
      expect(apiMock.dismissIntroCard).toHaveBeenCalledWith("processes");
    });
    expect(screen.queryByText(en.introProcessesTitle)).toBeNull();
  });

  it("stays hidden for users who already dismissed it", async () => {
    apiMock.topProcesses.mockResolvedValue(answer);
    apiMock.getSettings.mockResolvedValue(settings({ dismissed_cards: ["processes"] }));
    render(React.createElement(ProcessesView, { active: false }));
    await screen.findByText("chrome");
    expect(screen.queryByText(en.introProcessesTitle)).toBeNull();
  });

  it("a settings reset re-shows the card without a restart", async () => {
    apiMock.topProcesses.mockResolvedValue(answer);
    apiMock.getSettings.mockResolvedValue(settings({ dismissed_cards: ["processes"] }));
    render(React.createElement(ProcessesView, { active: false }));
    await screen.findByText("chrome");
    expect(screen.queryByText(en.introProcessesTitle)).toBeNull();
    // the reset signal re-reads the (now empty) list on mounted views
    apiMock.getSettings.mockResolvedValue(settings());
    window.dispatchEvent(new Event(INTRO_CARDS_EVENT));
    await screen.findByText(en.introProcessesTitle);
  });
});
