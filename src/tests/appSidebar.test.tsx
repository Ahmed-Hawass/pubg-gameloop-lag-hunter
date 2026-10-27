// tests/appSidebar.test.tsx - the shell rail contract: tabs report
// clicks back (the shell clears deep-links), the active tab announces
// itself, and the collapse control flips.

import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { Cpu } from "lucide-react";
import { en } from "../locales/en";
import { AppSidebar } from "../components/AppSidebar";

const tabs = [
  { id: "monitor" as const, icon: <Cpu size={17} />, label: en.monitor },
  { id: "tools" as const, icon: <Cpu size={17} />, label: en.tools },
];

function open(over: Partial<React.ComponentProps<typeof AppSidebar>> = {}) {
  const onSelect = vi.fn();
  const onAbout = vi.fn();
  const onToggleSidebar = vi.fn();
  render(
    React.createElement(AppSidebar, {
      t: en,
      tabs,
      view: "monitor",
      collapsed: false,
      updateInfo: null,
      onSelect,
      onAbout,
      onToggleSidebar,
      ...over,
    }),
  );
  return { onSelect, onAbout, onToggleSidebar };
}

describe("AppSidebar", () => {
  it("reports tab clicks and marks the active tab current", async () => {
    const user = userEvent.setup();
    const { onSelect } = open();
    await user.click(screen.getByText(en.tools));
    expect(onSelect).toHaveBeenCalledWith("tools");
    expect(screen.getByText(en.monitor).closest("button")!.getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("opens About and flips the collapse control", async () => {
    const user = userEvent.setup();
    const { onAbout, onToggleSidebar } = open();
    await user.click(screen.getByText(en.about));
    expect(onAbout).toHaveBeenCalledOnce();
    await user.click(screen.getByText(en.collapseMenu));
    expect(onToggleSidebar).toHaveBeenCalledOnce();
  });

  it("shows the update dot everywhere except About itself", () => {
    const info = {
      version: "9.9.9",
      notes_en: [],
      notes_ar: [],
      notes_url: "",
      asset_url: "",
      asset_name: "",
      sums_url: "",
    };
    open({ updateInfo: info });
    expect(document.querySelector(".sb-dot")).toBeTruthy();
    cleanup();
    open({ updateInfo: info, view: "about" });
    expect(document.querySelector(".sb-dot")).toBeNull();
  });

  it("names the collapse control in both states", () => {
    open({ collapsed: false });
    const expanded = screen.getByRole("button", { name: en.collapseMenu });
    expect(expanded.getAttribute("aria-expanded")).toBe("true");
    cleanup();
    open({ collapsed: true });
    const collapsedBtn = screen.getByRole("button", { name: en.expandMenu });
    expect(collapsedBtn.getAttribute("aria-expanded")).toBe("false");
  });

  it("names icon-only tabs when collapsed", () => {
    open({ collapsed: true });
    // labels are hidden on the rail: the accessible name rides the
    // button itself (tooltips are visual-only)
    expect(screen.getByRole("button", { name: en.monitor })).toBeTruthy();
    expect(screen.getByRole("button", { name: en.about })).toBeTruthy();
  });
});
