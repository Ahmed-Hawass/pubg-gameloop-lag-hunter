// tests/processes.test.tsx — the processes contract: a totals header
// that never understates (every background process counts, not just the
// displayed rows), then user apps versus system tasks from the engine's
// own grouping (never guessed in the UI).

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { ProcessesView } from "../views/ProcessesView";
import type { TopProcesses } from "../bridge";
import { INTRO_CARDS_EVENT } from "../useIntroCard";
import { settings } from "./fixtures";

const apiMock = vi.hoisted(() => ({
  topProcesses: vi.fn(),
  endProcesses: vi.fn(),
  processIcons: vi.fn(),
  getSettings: vi.fn(),
  dismissIntroCard: vi.fn(),
}));

vi.mock("../bridge", () => ({
  api: apiMock,
}));

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
}));

// icons resolve empty by default (glyph path); single tests override
apiMock.processIcons.mockResolvedValue([]);

const answer: TopProcesses = {
  processes: [
    { name: "chrome", pid: 1, pids: [1], cpu_pct: 9.8, ram_mb: 287, kind: "app", display_key: null, display_name: "chrome" },
    { name: "code", pid: 2, pids: [2], cpu_pct: 1.0, ram_mb: 287, kind: "app", display_key: null, display_name: "code" },
    { name: "svchost", pid: 3, pids: [3], cpu_pct: 0.5, ram_mb: 79, kind: "system", display_key: null, display_name: "svchost" },
  ],
  total_cpu: 13.7,
  total_ram_mb: 546,
};

describe("ProcessesView", () => {
  it("shows honest totals plus the apps list", async () => {
    apiMock.topProcesses.mockResolvedValue(answer);
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ProcessesView, { active: false }));
    // totals come from the answer, not from summing the visible rows
    await screen.findByText("13.7%");
    expect(screen.getByText("546 MB")).toBeTruthy();
    // one apps group with its guidance, system rows never render
    expect(screen.getByText(en.groupAppsTitle)).toBeTruthy();
    expect(screen.getByText(en.groupAppsHint)).toBeTruthy();
    expect(screen.getByText("chrome")).toBeTruthy();
    expect(screen.queryByText("svchost")).toBeNull();
  });

  it("system-kind rows never render, even alone", async () => {
    apiMock.topProcesses.mockResolvedValue({
      processes: [
        { name: "dwm", pid: 9, pids: [9], cpu_pct: 2.0, ram_mb: 100, kind: "system", display_key: "procDwm", display_name: "dwm" },
      ],
      total_cpu: 2.0,
      total_ram_mb: 100,
    });
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ProcessesView, { active: false }));
    // totals still count it, but no row invites action on it
    await screen.findByText(en.topProcessesEmpty);
    expect(screen.queryByText(en.groupAppsTitle)).toBeNull();
  });

  it("app names show verbatim, system rows stay off-screen", async () => {    apiMock.topProcesses.mockResolvedValue({
      processes: [
        { name: "powershell", pid: 1, pids: [1], cpu_pct: 5.0, ram_mb: 50, kind: "system", display_key: "procPowershell", display_name: "powershell" },
        { name: "brave", pid: 2, pids: [2], cpu_pct: 4.0, ram_mb: 400, kind: "app", display_key: null, display_name: "Brave" },
      ],
      total_cpu: 9.0,
      total_ram_mb: 450,
    });
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ProcessesView, { active: false }));
    // ProductName verbatim, no invention
    expect(await screen.findByText("Brave")).toBeTruthy();
    // the system row never renders (its translation with it)
    expect(screen.queryByText(en.procNames.procPowershell)).toBeNull();
    expect(screen.queryByText("powershell")).toBeNull();
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

  it("app rows carry an end-task action, system rows carry none", async () => {
    apiMock.topProcesses.mockResolvedValue(answer);
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ProcessesView, { active: false }));
    await screen.findByText("chrome");
    // one button per app row, none for the system row
    expect(screen.getAllByText(en.endTask)).toHaveLength(2);
  });

  it("confirming end-task kills the whole group then forces a fresh read", async () => {
    const user = userEvent.setup();
    apiMock.topProcesses.mockResolvedValue(answer);
    apiMock.getSettings.mockResolvedValue(settings());
    apiMock.endProcesses.mockResolvedValue(undefined);
    render(React.createElement(ProcessesView, { active: false }));
    await screen.findByText("chrome");
    apiMock.topProcesses.mockClear();
    await user.click(screen.getAllByText(en.endTask)[0]);
    // confirm names the app and warns about unsaved work
    await screen.findByText(en.endConfirmTitle("chrome"));
    expect(screen.getByText(en.endConfirmBody("chrome"))).toBeTruthy();
    await user.click(
      within(screen.getByText(en.endConfirmTitle("chrome")).closest(".dialog-box")!).getByText(
        en.endTask,
      ),
    );
    await waitFor(() => {
      expect(apiMock.endProcesses).toHaveBeenCalledWith([1]);
    });
    // verify by re-read: the forced refresh follows the kill
    await waitFor(() => {
      expect(apiMock.topProcesses).toHaveBeenCalledWith(true);
    });
  });

  it("a refused kill surfaces the locale copy on the one dialog", async () => {
    const user = userEvent.setup();
    apiMock.topProcesses.mockResolvedValue(answer);
    apiMock.getSettings.mockResolvedValue(settings());
    apiMock.endProcesses.mockRejectedValue("PROCESS_ACCESS_DENIED");
    render(React.createElement(ProcessesView, { active: false }));
    await screen.findByText("chrome");
    await user.click(screen.getAllByText(en.endTask)[0]);
    await screen.findByText(en.endConfirmTitle("chrome"));
    await user.click(
      within(screen.getByText(en.endConfirmTitle("chrome")).closest(".dialog-box")!).getByText(
        en.endTask,
      ),
    );
    await screen.findByText(en.errors.PROCESS_ACCESS_DENIED);
  });

  it("a grouped app names its size and kills every member", async () => {
    const user = userEvent.setup();
    apiMock.topProcesses.mockResolvedValue({
      processes: [
        { name: "brave", pid: 11, pids: [11, 10, 12], cpu_pct: 28.4, ram_mb: 164, kind: "app", display_key: null, display_name: "Brave" },
      ],
      total_cpu: 28.4,
      total_ram_mb: 164,
    });
    apiMock.getSettings.mockResolvedValue(settings());
    apiMock.endProcesses.mockResolvedValue(undefined);
    render(React.createElement(ProcessesView, { active: false }));
    // one row for the whole program, sized honestly
    await screen.findByText(en.procCount(3));
    await user.click(screen.getByText(en.endTask));
    await screen.findByText(en.endConfirmTitle("Brave"));
    expect(
      screen.getByText(en.endConfirmBodyCount("Brave", en.procCount(3))),
    ).toBeTruthy();
    await user.click(
      within(screen.getByText(en.endConfirmTitle("Brave")).closest(".dialog-box")!).getByText(
        en.endTask,
      ),
    );
    await waitFor(() => {
      expect(apiMock.endProcesses).toHaveBeenCalledWith([11, 10, 12]);
    });
  });

  it("resolved artwork replaces the glyph, misses keep it", async () => {
    apiMock.topProcesses.mockResolvedValue(answer);
    apiMock.getSettings.mockResolvedValue(settings());
    apiMock.processIcons.mockResolvedValue([{ pid: 1, url: "data:image/png;base64,iVBORw0KGgo" }]);
    render(React.createElement(ProcessesView, { active: false }));
    await screen.findByText("chrome");
    // asked once for the new app PIDs only (system rows are not listed)
    await waitFor(() => {
      expect(apiMock.processIcons).toHaveBeenCalledWith([1, 2]);
    });
    // chrome paints art, code keeps the generic tile (no img inside it)
    const imgs = document.querySelectorAll(".proc-list img.proc-icon");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo");
  });

  it("an idle app at 0.0% keeps its row with live numbers", async () => {
    apiMock.topProcesses.mockResolvedValue({
      processes: [
        { name: "brave", pid: 2, pids: [2, 3], cpu_pct: 0.0, ram_mb: 400, kind: "app", display_key: null, display_name: "Brave" },
      ],
      total_cpu: 0.0,
      total_ram_mb: 400,
    });
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ProcessesView, { active: false }));
    // membership is not CPU-gated: zero reads honest, never hidden
    // (totals header plus the row itself)
    expect(await screen.findAllByText("0.0%")).toHaveLength(2);
    expect(await screen.findAllByText("400 MB")).toHaveLength(2);
    expect(screen.getByText(en.endTask)).toBeTruthy();
  });

  it("duplicate program names render every row (keys are PIDs, not names)", async () => {
    apiMock.topProcesses.mockResolvedValue({
      processes: [
        { name: "helper", pid: 11, pids: [11], cpu_pct: 3.0, ram_mb: 100, kind: "app", display_key: null, display_name: "Helper" },
        { name: "helper", pid: 22, pids: [22], cpu_pct: 4.0, ram_mb: 120, kind: "app", display_key: null, display_name: "Helper" },
      ],
      total_cpu: 7.0,
      total_ram_mb: 220,
    });
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ProcessesView, { active: false }));
    // a name-keyed list would collapse these into one row
    expect(await screen.findAllByText("Helper")).toHaveLength(2);
    expect(screen.getAllByText(en.endTask)).toHaveLength(2);
  });

  it("a load failure offers a manual retry that forces a fresh read", async () => {
    const user = userEvent.setup();
    apiMock.topProcesses.mockRejectedValue("PS_TIMEOUT");
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ProcessesView, { active: false }));
    await screen.findByText(en.dialog.somethingWrong);
    apiMock.topProcesses.mockClear();
    apiMock.topProcesses.mockResolvedValue(answer);
    await user.click(screen.getByText(en.refresh));
    await waitFor(() => {
      expect(apiMock.topProcesses).toHaveBeenCalledWith(true);
    });
    await screen.findByText("chrome");
  });
});
