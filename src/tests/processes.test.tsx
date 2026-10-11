// tests/processes.test.tsx — the processes contract: one actionable apps
// list, measured on resident memory only (the engine sends no CPU and no
// totals), each row names its RAM under its name, user apps versus system
// tasks from the engine's own grouping (never guessed in the UI).

import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
    { name: "chrome", pid: 1, pids: [1], ram_mb: 287, kind: "app", display_key: null, display_name: "chrome" },
    { name: "code", pid: 2, pids: [2], ram_mb: 287, kind: "app", display_key: null, display_name: "code" },
    { name: "svchost", pid: 3, pids: [3], ram_mb: 79, kind: "system", display_key: null, display_name: "svchost" },
  ],
};

describe("ProcessesView", () => {
  it("shows the apps list with each app's RAM under its name", async () => {
    apiMock.topProcesses.mockResolvedValue(answer);
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ProcessesView, { active: false }));
    await screen.findByText("chrome");
    expect(screen.getByText("code")).toBeTruthy();
    // the engine sends no CPU and no totals, but each row carries its
    // own labeled RAM line: the order says heaviest first, the line
    // says what the number is (both chrome and code hold 287 MB here)
    expect(document.querySelector(".procs-about")?.textContent).toBe(en.procsAbout);
    expect(screen.getAllByText(en.procRamUsage(287))).toHaveLength(2);
    expect(screen.queryByText("13.7%")).toBeNull();
    expect(screen.queryByText("546 MB")).toBeNull();
    // no group heading above the one list
    expect(document.querySelector(".proc-group")).toBeNull();
    expect(document.querySelector(".totals")).toBeNull();
  });

  it("the standing one-liner survives the intro card being dismissed", async () => {
    const user = userEvent.setup();
    apiMock.topProcesses.mockResolvedValue(answer);
    apiMock.getSettings.mockResolvedValue(settings());
    apiMock.dismissIntroCard.mockResolvedValue(undefined);
    render(React.createElement(ProcessesView, { active: false }));
    // both are present on a first visit
    expect(await screen.findByText(en.introProcessesTitle)).toBeTruthy();
    expect(screen.getByText(en.procsAbout)).toBeTruthy();
    // the card is one-shot; the description of the page is not
    await user.click(screen.getByRole("button", { name: en.dialog.dismiss }));
    await waitFor(() => {
      expect(screen.queryByText(en.introProcessesTitle)).toBeNull();
    });
    expect(screen.getByText(en.procsAbout)).toBeTruthy();
  });

  it("system-kind rows never render, even alone", async () => {
    apiMock.topProcesses.mockResolvedValue({
      processes: [
        { name: "dwm", pid: 9, pids: [9], ram_mb: 100, kind: "system", display_key: "procDwm", display_name: "dwm" },
      ],
    });
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ProcessesView, { active: false }));
    // no apps on screen means the empty state, never a row (system tasks
    // are not something the user can close)
    await screen.findByText(en.topProcessesEmpty);
    expect(screen.queryByText("dwm")).toBeNull();
    expect(screen.queryByText(en.procNames.procDwm)).toBeNull();
  });

  it("app names show verbatim, system rows stay off-screen", async () => {    apiMock.topProcesses.mockResolvedValue({
      processes: [
        { name: "powershell", pid: 1, pids: [1], ram_mb: 50, kind: "system", display_key: "procPowershell", display_name: "powershell" },
        { name: "brave", pid: 2, pids: [2], ram_mb: 400, kind: "app", display_key: null, display_name: "Brave" },
      ],
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

  it("pauses the live poll while the document is hidden", async () => {
    // sync act flushes (welcome.test.tsx pattern): waitFor deadlocks
    // under fake timers and hung this file once, so no waits here.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    vi.useFakeTimers();
    try {
      apiMock.topProcesses.mockResolvedValue(answer);
      apiMock.getSettings.mockResolvedValue(settings());
      render(React.createElement(ProcessesView, { active: true }));
      await act(async () => {});
      const before = apiMock.topProcesses.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      await act(async () => {});
      const ticked = apiMock.topProcesses.mock.calls.length;
      expect(ticked).toBeGreaterThan(before);
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      await act(async () => {
        vi.advanceTimersByTime(6000);
      });
      await act(async () => {});
      expect(apiMock.topProcesses.mock.calls.length).toBe(ticked);
    } finally {
      vi.useRealTimers();
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
    }
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

  it("a grouped app counts its members in the confirm, not on the row", async () => {
    const user = userEvent.setup();
    apiMock.topProcesses.mockResolvedValue({
      processes: [
        { name: "brave", pid: 11, pids: [11, 10, 12], ram_mb: 164, kind: "app", display_key: null, display_name: "Brave" },
      ],
    });
    apiMock.getSettings.mockResolvedValue(settings());
    apiMock.endProcesses.mockResolvedValue(undefined);
    render(React.createElement(ProcessesView, { active: false }));
    // one row for the whole program, and the row stays bare: the count
    // only appears where it changes what happens (the confirm names how
    // many windows the kill will take)
    await screen.findByText("Brave");
    expect(screen.queryByText(en.procCount(3))).toBeNull();
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

  it("an app nobody measures still keeps its row (membership is not load-gated)", async () => {
    apiMock.topProcesses.mockResolvedValue({
      processes: [
        { name: "brave", pid: 2, pids: [2, 3], ram_mb: 400, kind: "app", display_key: null, display_name: "Brave" },
      ],
    });
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ProcessesView, { active: false }));
    // the row carries its RAM line even so: the list is a "what can I
    // close", not a leaderboard
    expect(await screen.findByText("Brave")).toBeTruthy();
    expect(screen.getByText(en.procRamUsage(400))).toBeTruthy();
    expect(screen.queryByText(en.procCount(2))).toBeNull();
    expect(screen.getByText(en.endTask)).toBeTruthy();
  });

  it("a gigabyte-plus app reads in GB, never a four-digit MB count", async () => {
    apiMock.topProcesses.mockResolvedValue({
      processes: [
        { name: "brave", pid: 2, pids: [2], ram_mb: 2048, kind: "app", display_key: null, display_name: "Brave" },
      ],
    });
    apiMock.getSettings.mockResolvedValue(settings());
    render(React.createElement(ProcessesView, { active: false }));
    expect(await screen.findByText("Brave")).toBeTruthy();
    expect(screen.getByText(en.procRamUsage(2048))).toBeTruthy();
    expect(screen.queryByText(en.procRamUsage(287))).toBeNull();
  });

  it("duplicate program names render every row (keys are PIDs, not names)", async () => {
    apiMock.topProcesses.mockResolvedValue({
      processes: [
        { name: "helper", pid: 11, pids: [11], ram_mb: 100, kind: "app", display_key: null, display_name: "Helper" },
        { name: "helper", pid: 22, pids: [22], ram_mb: 120, kind: "app", display_key: null, display_name: "Helper" },
      ],
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
