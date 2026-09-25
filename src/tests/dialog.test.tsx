// tests/dialog.test.ts — the ONE modal surface contract: focus never
// leaves the dialog, Escape always dismisses, and only notices dismiss
// on backdrop click (confirms need an explicit choice).

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { Dialog } from "../components/components";

function notice(onClose = vi.fn()) {
  render(
    React.createElement(Dialog, {
      title: "Something went wrong",
      body: "boom",
      kind: "notice",
      okLabel: "OK",
      onClose,
    }),
  );
  return onClose;
}

function confirm(onClose = vi.fn(), onConfirm = vi.fn()) {
  render(
    React.createElement(Dialog, {
      title: "Delete this session?",
      body: "gone",
      kind: "confirm",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      okLabel: "OK",
      danger: true,
      onConfirm,
      onClose,
    }),
  );
  return { onClose, onConfirm };
}

describe("Dialog", () => {
  it("starts focus on the safe choice (cancel, not the destructive one)", () => {
    confirm();
    expect(screen.getByText("Cancel")).toBe(document.activeElement);
  });

  it("traps Tab inside: last -> first and first -> last", async () => {
    const user = userEvent.setup();
    confirm();
    const cancel = screen.getByText("Cancel");
    const del = screen.getByText("Delete");
    // autoFocus lands on Cancel; Shift+Tab wraps to the last button
    await user.tab({ shift: true });
    expect(del).toBe(document.activeElement);
    // plain Tab from the last button wraps back to the first
    await user.tab();
    expect(cancel).toBe(document.activeElement);
  });

  it("Escape dismisses both kinds", async () => {
    const user = userEvent.setup();
    const onCloseNotice = notice();
    await user.keyboard("{Escape}");
    expect(onCloseNotice).toHaveBeenCalledTimes(1);

    const { onClose } = confirm();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("backdrop click dismisses a notice but never a confirm", () => {
    const onCloseNotice = notice();
    fireEvent.click(screen.getByText("boom").closest(".dialog-overlay")!);
    expect(onCloseNotice).toHaveBeenCalledTimes(1);

    const { onClose } = confirm();
    fireEvent.click(screen.getByText("gone").closest(".dialog-overlay")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("confirm runs the action then closes", async () => {
    const user = userEvent.setup();
    const { onClose, onConfirm } = confirm();
    await user.click(screen.getByText("Delete"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
