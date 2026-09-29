// tests/reports.test.tsx — the saved-sessions contract: rows open their
// reports, deep-links resolve (or say so), deletion is always confirmed
// and reported back, and a failed list is a page state, never a modal.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { en } from "../locales/en";
import { ReportsView } from "../views/ReportsView";
import type { FriendlyReport, SessionEntry } from "../bridge";

const apiMock = vi.hoisted(() => ({
  sessionEntries: vi.fn(),
  loadReport: vi.fn(),
  deleteSession: vi.fn(),
  deleteAllSessions: vi.fn(),
  sessionsRoot: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock("../bridge", () => ({
  api: apiMock,
}));

vi.mock("../i18n", () => ({
  useLang: () => ({ t: en, lang: "en", setting: "en", setLanguage: vi.fn() }),
}));

const entries: SessionEntry[] = [
  {
    id: "session-1",
    date: "2026-09-25 10:00",
    duration_sec: 300,
    samples: 300,
    lag_spikes: 0,
    outcome: "clean",
  },
  {
    id: "session-2",
    date: "2026-09-25 11:00",
    duration_sec: 125,
    samples: 125,
    lag_spikes: 2,
    outcome: "laggy",
  },
];

const report: FriendlyReport = {
  id: "session-2",
  date: "2026-09-25 11:00",
  duration_sec: 125,
  samples: 125,
  lag_spikes: 2,
  outcome: "laggy",
  highlights: [{ kind: "spike", clock: "00:01", dur_sec: 5 }],
  metrics_summary: [{ key: "cpuPeak", value: 95 }],
  findings: [
    {
      key: "disk_wait",
      title: "backend english",
      simple: "backend simple",
      fix: "backend fix",
      severity: "high",
    },
  ],
  raw_path: "C:/sessions/session-2/report.md",
};

function open(props: Partial<React.ComponentProps<typeof ReportsView>> = {}) {
  const onOpened = vi.fn();
  const onDeleted = vi.fn();
  const onDeletedAll = vi.fn();
  // each test presets its own sessionEntries answers BEFORE opening:
  // the list identity matters (a same-reference re-read bails out of
  // rendering, exactly like production re-reads from disk)
  render(
    React.createElement(ReportsView, {
      openId: null,
      onOpened,
      onDeleted,
      onDeletedAll,
      runningSessionId: null,
      active: true,
      ...props,
    }),
  );
  return { onOpened, onDeleted, onDeletedAll };
}

describe("ReportsView", () => {
  it("lists sessions and opens the translated report on row click", async () => {
    const user = userEvent.setup();
    apiMock.sessionEntries.mockResolvedValue(entries);
    apiMock.loadReport.mockResolvedValue(report);
    open();
    await screen.findByText("2026-09-25 10:00");
    // durations read naturally, spike counts ride the badge
    expect(screen.getByText(en.spikeCount(2))).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: `2026-09-25 11:00, ${en.lagCaptured}` }),
    );
    // machine keys translated, never backend english in the UI
    await screen.findByText(en.diagnoses.disk_wait.title);
    expect(screen.queryByText("backend english")).toBeNull();
    expect(screen.getByText(en.sessionReport)).toBeTruthy();
  });

  it("a deep-link to a missing session says so and clears one-shot", async () => {
    // fresh array identities per read: production re-reads from disk,
    // and a same-reference answer would bail out of rendering entirely
    apiMock.sessionEntries
      .mockResolvedValueOnce([...entries])
      .mockResolvedValueOnce([...entries]);
    const { onOpened } = open({ openId: "gone" });
    await waitFor(() => {
      expect(screen.getByText(en.reportNotFound)).toBeTruthy();
    });
    expect(onOpened).toHaveBeenCalledOnce();
  });

  it("delete asks first, then deletes and reports back", async () => {
    const user = userEvent.setup();
    apiMock.sessionEntries.mockResolvedValue(entries);
    apiMock.deleteSession.mockResolvedValue(undefined);
    const { onDeleted } = open();
    await screen.findByText("2026-09-25 10:00");
    const row = screen
      .getByRole("button", { name: `2026-09-25 10:00, ${en.clean}` })
      .closest("li")!;
    await user.click(
      within(row).getByRole("button", { name: en.deleteSession }),
    );
    await screen.findByText(en.dialog.deleteTitle);
    await user.click(screen.getByText(en.dialog.delete));
    await waitFor(() => {
      expect(apiMock.deleteSession).toHaveBeenCalledWith("session-1");
    });
    expect(onDeleted).toHaveBeenCalledWith("session-1");
  });

  it("delete-all names the count, passes the live id, and locks while running", async () => {
    const user = userEvent.setup();
    apiMock.sessionEntries.mockResolvedValue(entries);
    apiMock.deleteAllSessions.mockResolvedValue(["session-1", "session-2"]);
    const { onDeletedAll } = open();
    await screen.findByText("2026-09-25 10:00");
    await user.click(screen.getByText(en.deleteAllSessions));
    await screen.findByText(en.dialog.deleteAllTitle);
    await user.click(
      within(screen.getByText(en.dialog.deleteAllTitle).closest(".dialog-box")!).getByText(
        en.dialog.delete,
      ),
    );
    await waitFor(() => {
      expect(apiMock.deleteAllSessions).toHaveBeenCalledWith(null);
    });
    expect(onDeletedAll).toHaveBeenCalledWith(["session-1", "session-2"]);
  });

  it("delete-all is disabled while a scan runs", async () => {
    apiMock.sessionEntries.mockResolvedValue(entries);
    open({ runningSessionId: "session-live" });
    await screen.findByText("2026-09-25 10:00");
    expect(screen.getByText(en.deleteAllSessions).closest("button")).toBeDisabled();
  });

  it("a failed list is a page state with no modal", async () => {
    apiMock.sessionEntries.mockRejectedValue("disk gone");
    open();
    await screen.findByText(en.dialog.somethingWrong);
    // the one modal surface stays free: no dialog chrome anywhere
    expect(document.querySelector(".dialog-overlay")).toBeNull();
  });

  it("totals count sessions and issue rows, partial stays out", async () => {
    const user = userEvent.setup();
    apiMock.sessionEntries.mockResolvedValue([
      ...entries,
      { id: "session-3", date: "2026-09-25 12:00", duration_sec: 10, samples: 10, lag_spikes: 0, outcome: "partial" },
    ]);
    apiMock.loadReport.mockResolvedValue(report);
    open();
    await screen.findByText("2026-09-25 10:00");
    // 3 saved, 1 with issues (the interrupted partial is unknown, not an issue)
    const totals = document.querySelector(".totals") as HTMLElement;
    expect(within(totals).getByText("3")).toBeTruthy();
    expect(within(totals).getByText("1")).toBeTruthy();
    expect(within(totals).getByText(en.reportTotalSessions)).toBeTruthy();
    expect(within(totals).getByText(en.reportTotalIssues)).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: `2026-09-25 11:00, ${en.lagCaptured}` }),
    );
    await screen.findByText(en.sessionReport);
  });

  it("key moments collapse behind the shared feed toggle", async () => {
    const user = userEvent.setup();
    apiMock.sessionEntries.mockResolvedValue(entries);
    apiMock.loadReport.mockResolvedValue({
      ...report,
      highlights: [
        { kind: "spike", clock: "00:01", dur_sec: 5 },
        { kind: "disk_queue", clock: "00:02", dur_sec: null },
        { kind: "mostly_background", clock: "", dur_sec: null },
      ],
    });
    open();
    await screen.findByText("2026-09-25 10:00");
    await user.click(
      screen.getByRole("button", { name: `2026-09-25 11:00, ${en.lagCaptured}` }),
    );
    await screen.findByText(en.keyMoments);
    // dots carry the kind severity: drops danger, load warn, notes neutral
    const items = document.querySelectorAll(".report-moments li");
    expect(items).toHaveLength(3);
    expect(items[0].classList.contains("hl-bad")).toBe(true);
    expect(items[1].classList.contains("hl-warn")).toBe(true);
    expect(items[2].className).toBe("");
    expect(screen.getByText(en.hideEventLog)).toBeTruthy();
    await user.click(screen.getByText(en.hideEventLog));
    expect(screen.getByText(en.showEventLog)).toBeTruthy();
    // the moment list hides with the toggle (same toggle as the monitor feed)
    expect(document.querySelector(".report-moments")).toBeNull();
    await user.click(screen.getByText(en.showEventLog));
    expect(screen.getByText(en.hideEventLog)).toBeTruthy();
  });
});
