// tests/tip.test.tsx — Tip orphan/stick contract: an empty text never
// renders a bubble, flipping text to "" clears a previously shown bubble
// (the sidebar expand orphan), and Escape/resize hide a live bubble.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Tip } from "../components/components";

function open(text: string) {
  const view = render(
    <Tip text={text}>
      <button type="button">trigger</button>
    </Tip>,
  );
  return view;
}

function wrap() {
  return document.querySelector(".tip-wrap") as HTMLElement;
}

describe("Tip", () => {
  it("shows a bubble on hover when text is present", () => {
    open("hello");
    fireEvent.mouseEnter(wrap());
    expect(screen.getByRole("tooltip").textContent).toBe("hello");
  });

  it("never renders a bubble for empty text", () => {
    open("");
    fireEvent.mouseEnter(wrap());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("clearing the text removes an already shown bubble (expand orphan)", () => {
    const view = open("expand");
    fireEvent.mouseEnter(wrap());
    expect(screen.getByRole("tooltip")).toBeTruthy();
    view.rerender(
      <Tip text="">
        <button type="button">trigger</button>
      </Tip>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("Escape hides a live bubble", () => {
    open("hello");
    fireEvent.mouseEnter(wrap());
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keyboard focus shows the bubble (Tab users keep the tip)", () => {
    // narrow stub: only :focus-visible is forced, everything else falls
    // through to the real matches (a blanket mock breaks the query
    // engine itself, which matches selectors internally).
    const real = window.HTMLElement.prototype.matches;
    const spy = vi
      .spyOn(window.HTMLElement.prototype, "matches")
      .mockImplementation(function (this: HTMLElement, sel: string) {
        return sel === ":focus-visible" ? true : real.call(this, sel);
      });
    try {
      open("hello");
      fireEvent.focus(screen.getByRole("button", { name: "trigger" }));
      expect(screen.getByRole("tooltip").textContent).toBe("hello");
    } finally {
      spy.mockRestore();
    }
  });

  it("non-keyboard focus shows nothing (minimize-restore orphan)", () => {
    const real = window.HTMLElement.prototype.matches;
    const spy = vi
      .spyOn(window.HTMLElement.prototype, "matches")
      .mockImplementation(function (this: HTMLElement, sel: string) {
        return sel === ":focus-visible" ? false : real.call(this, sel);
      });
    try {
      open("hello");
      fireEvent.focus(screen.getByRole("button", { name: "trigger" }));
      expect(screen.queryByRole("tooltip")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
