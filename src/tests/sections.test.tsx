// tests/sections.test.tsx — the shared section shapes: the verdict
// banner reads its tone from the count, and the featured-plus-archive
// list keys both copies without collision. Pure props, no backend.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SummaryArchive, VerdictBanner } from "../components/sections";

describe("VerdictBanner", () => {
  it("announces all-good versus the warn count", () => {
    const { unmount } = render(
      <VerdictBanner ok title="All good" sub="Nothing holding back" />,
    );
    expect(document.querySelector(".health-banner.ok")).toBeTruthy();
    expect(screen.getByText("All good")).toBeTruthy();
    unmount();
    render(<VerdictBanner ok={false} title="2 need attention" sub="Rest is fine" />);
    expect(document.querySelector(".health-banner.warn")).toBeTruthy();
    expect(screen.getByText("2 need attention")).toBeTruthy();
  });
});

describe("SummaryArchive", () => {
  it("repeats warn rows featured and hides the section when quiet", () => {
    const warn = [{ id: "power", el: <span>power card</span> }];
    const all = [
      { id: "power", el: <span>power card</span> },
      { id: "vt", el: <span>vt card</span> },
    ];
    render(
      <SummaryArchive warnTitle="Needs attention" archiveTitle="All" warn={warn} all={all} />,
    );
    // featured copy plus archive copy: the deliberate repeat
    expect(screen.getAllByText("power card")).toHaveLength(2);
    expect(screen.getByText("vt card")).toBeTruthy();
  });

  it("drops the featured section when nothing warns", () => {
    render(
      <SummaryArchive
        warnTitle="Needs attention"
        archiveTitle="All"
        warn={[]}
        all={[{ id: "vt", el: <span>vt card</span> }]}
      />,
    );
    expect(screen.queryByText("Needs attention")).toBeNull();
    expect(screen.getByText("vt card")).toBeTruthy();
  });
});
