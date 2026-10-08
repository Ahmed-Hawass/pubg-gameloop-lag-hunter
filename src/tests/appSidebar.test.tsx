// tests/appSidebar.test.tsx — the shell rail contract: tabs report
// clicks back (the shell clears deep-links), the active tab announces
// itself, the beta pill shows expanded only, and the collapse control
// flips.

import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { Cpu } from "lucide-react";
import { en } from "../locales/en";
import { AppSidebar } from "../components/AppSidebar";

const tabs = [
  { id: "monitor" as const, icon: <Cpu size={17} />, label: en.monitor },
  { id: "tools" as const, icon: <Cpu size={17} />, label: en.tools, beta: true },
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

  it("shows the beta pill expanded only", () => {
    open();
    expect(screen.getByText(en.toolsBeta)).toBeTruthy();
    cleanup();
    open({ collapsed: true });
    expect(screen.queryByText(en.toolsBeta)).toBeNull();
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
    const info = { version: "9.9.9", notes: "", asset_url: "", asset_name: "", sums_url: "" };
    open({ updateInfo: info });
    expect(document.querySelector(".sb-dot")).toBeTruthy();
    cleanup();
    open({ updateInfo: info, view: "about" });
    expect(document.querySelector(".sb-dot")).toBeNull();
  });
});
