// tests/modalEvents.test.tsx — the typed modal-surface signals: helpers
// dispatch the exact event names listeners subscribe to (a renamed
// signal breaks the build instead of going silent), and Hint wires its
// bubble to assistive tech while it is open.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  APP_DIALOG_OPEN_EVENT,
  Hint,
  MODAL_OPEN_EVENT,
  dispatchAppDialogOpen,
  dispatchModalOpen,
} from "../components/components";

describe("modal-surface signals", () => {
  it("dispatchModalOpen fires the subscribed name", () => {
    const seen = vi.fn();
    window.addEventListener(MODAL_OPEN_EVENT, seen);
    dispatchModalOpen();
    expect(seen).toHaveBeenCalledOnce();
    window.removeEventListener(MODAL_OPEN_EVENT, seen);
  });

  it("dispatchAppDialogOpen fires the subscribed name", () => {
    const seen = vi.fn();
    window.addEventListener(APP_DIALOG_OPEN_EVENT, seen);
    dispatchAppDialogOpen();
    expect(seen).toHaveBeenCalledOnce();
    window.removeEventListener(APP_DIALOG_OPEN_EVENT, seen);
  });
});

describe("Hint", () => {
  it("exposes its bubble to assistive tech while open", () => {
    render(React.createElement(Hint, { text: "closed apps run cooler" }));
    const btn = screen.getByRole("button", { name: "closed apps run cooler" });
    fireEvent.focus(btn);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe("closed apps run cooler");
    expect(btn.getAttribute("aria-describedby")).toBe(tip.getAttribute("id"));
    fireEvent.blur(btn);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(btn.getAttribute("aria-describedby")).toBeNull();
  });
});
