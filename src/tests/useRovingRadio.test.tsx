// tests/useRovingRadio.test.tsx - the radio-group keyboard contract the
// hand-rolled pills share: one tab stop, arrows select, Home/End jump, and
// RTL flips only the horizontal arrows.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useRovingRadio } from "../useRovingRadio";

const VALUES = ["a", "b", "c"] as const;

function Harness(props: { initial: string; dir?: "ltr" | "rtl" }) {
  const [value, setValue] = useState(props.initial);
  const radio = useRovingRadio(VALUES, value, setValue);
  return (
    <div
      dir={props.dir ?? "ltr"}
      role="radiogroup"
      aria-label="letters"
      onKeyDown={radio.onKeyDown}
    >
      {VALUES.map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          tabIndex={radio.tabIndexFor(v)}
          ref={(el) => radio.setItemRef(v, el)}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

describe("useRovingRadio", () => {
  it("keeps one tab stop on the checked radio", () => {
    render(<Harness initial="b" />);
    expect(screen.getByRole("radio", { name: "a" }).tabIndex).toBe(-1);
    expect(screen.getByRole("radio", { name: "b" }).tabIndex).toBe(0);
    expect(screen.getByRole("radio", { name: "c" }).tabIndex).toBe(-1);
  });

  it("falls back to the first radio when the stored value is not offered", () => {
    render(<Harness initial="z" />);
    expect(screen.getByRole("radio", { name: "a" }).tabIndex).toBe(0);
    expect(screen.getByRole("radio", { name: "b" }).tabIndex).toBe(-1);
  });

  it("ArrowRight moves and selects, wrapping at the end", async () => {
    const user = userEvent.setup();
    render(<Harness initial="a" />);
    screen.getByRole("radio", { name: "a" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "b" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "b" })).toHaveFocus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("radio", { name: "a" })).toHaveFocus();
  });

  it("ArrowLeft and ArrowUp walk backwards, wrapping at the start", async () => {
    const user = userEvent.setup();
    render(<Harness initial="a" />);
    screen.getByRole("radio", { name: "a" }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "c" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("radio", { name: "b" })).toHaveFocus();
  });

  it("Home and End jump to the first and last radio", async () => {
    const user = userEvent.setup();
    render(<Harness initial="b" />);
    screen.getByRole("radio", { name: "b" }).focus();
    await user.keyboard("{End}");
    expect(screen.getByRole("radio", { name: "c" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("radio", { name: "a" })).toHaveFocus();
  });

  it("RTL flips horizontal arrows but leaves vertical ones alone", async () => {
    const user = userEvent.setup();
    render(<Harness initial="b" dir="rtl" />);
    screen.getByRole("radio", { name: "b" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "a" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "b" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "c" })).toHaveFocus();
  });
});
