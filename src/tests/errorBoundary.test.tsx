// tests/errorBoundary.test.tsx — the render-time crash contract: a
// throwing component must NOT leave a blank window, it must say plainly
// that the app broke and offer a reload.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { en } from "../locales/en";
import { ar } from "../locales/ar";
import { ErrorBoundary } from "../components/ErrorBoundary";

const logFrontendErrorMock = vi.hoisted(() =>
  vi.fn((_message: string) => Promise.resolve()),
);

vi.mock("../bridge", () => ({
  logFrontendError: logFrontendErrorMock,
}));

/** a component that throws while rendering — the exact case the boundary
    exists for */
function Boom(): React.ReactElement {
  throw new Error("kaboom from the view");
}

describe("ErrorBoundary", () => {
  it("shows the localized fallback instead of a blank window", () => {
    render(
      React.createElement(
        ErrorBoundary,
        { title: en.crashTitle, body: en.crashBody, reloadLabel: en.crashReload },
        React.createElement(Boom),
      ),
    );
    expect(screen.getByText(en.crashTitle)).toBeTruthy();
    expect(screen.getByText(en.crashBody)).toBeTruthy();
    expect(screen.getByText(en.crashReload)).toBeTruthy();
  });

  it("speaks Arabic when the app is Arabic", () => {
    render(
      React.createElement(
        ErrorBoundary,
        { title: ar.crashTitle, body: ar.crashBody, reloadLabel: ar.crashReload },
        React.createElement(Boom),
      ),
    );
    expect(screen.getByText(ar.crashTitle)).toBeTruthy();
    expect(screen.getByText(ar.crashBody)).toBeTruthy();
  });

  it("reports the crash to the backend log", () => {
    render(
      React.createElement(
        ErrorBoundary,
        { title: en.crashTitle, body: en.crashBody, reloadLabel: en.crashReload },
        React.createElement(Boom),
      ),
    );
    expect(logFrontendErrorMock).toHaveBeenCalled();
    expect(String(logFrontendErrorMock.mock.calls[0][0])).toContain("kaboom from the view");
  });

  it("leaves a healthy tree alone", () => {
    render(
      React.createElement(
        ErrorBoundary,
        { title: en.crashTitle, body: en.crashBody, reloadLabel: en.crashReload },
        React.createElement("p", null, "all good"),
      ),
    );
    expect(screen.getByText("all good")).toBeTruthy();
    expect(screen.queryByText(en.crashTitle)).toBeNull();
  });
});
