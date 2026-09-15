// errors.test.ts — the dialog mapping users see when a scan fails.

import { describe, expect, it } from "vitest";
import { errorDialog } from "../errors";
import { en } from "../locales/en";

const COPY = {
  somethingWrong: en.dialog.somethingWrong,
  scanNeedsGame: en.dialog.scanNeedsGame,
  scanNeedsGameBody: en.dialog.scanNeedsGameBody,
  unknownErrorBody: en.dialog.unknownErrorBody,
};

describe("errorDialog", () => {
  it("maps the game-not-running gate to its dedicated friendly dialog", () => {
    const d = errorDialog("GAMELOOP_NOT_RUNNING", en.errors, COPY);
    expect(d.title).toBe(en.dialog.scanNeedsGame);
    expect(d.body).toBe(en.dialog.scanNeedsGameBody);
    expect(d.key).toBe("GAMELOOP_NOT_RUNNING");
  });

  it("maps other known codes to the generic title + the code's copy", () => {
    const d = errorDialog("SESSION_ALREADY_RUNNING", en.errors, COPY);
    expect(d.title).toBe(en.dialog.somethingWrong);
    expect(d.body).toBe(en.errors.SESSION_ALREADY_RUNNING);
  });

  it("finds a code embedded in a longer error message", () => {
    const d = errorDialog(
      "engine error: SESSION_STOPPING (wait for flush)",
      en.errors,
      COPY,
    );
    expect(d.body).toBe(en.errors.SESSION_STOPPING);
  });

  it("unknown errors show the localized unknown-error body under the generic title", () => {
    // a novel backend message must never ship raw English into an Arabic
    // dialog: the locale explains and the raw string rides along as a
    // technical line
    const d = errorDialog("some novel failure", en.errors, COPY);
    expect(d.title).toBe(en.dialog.somethingWrong);
    expect(d.body).toBe(en.dialog.unknownErrorBody("some novel failure"));
    expect(d.body).toContain("some novel failure");
    expect(d.key).toBe("some novel failure");
  });

  it("a known code embedded in noise still wins over the unknown fallback", () => {
    const d = errorDialog("download task failed: SESSION_STOPPING", en.errors, COPY);
    expect(d.body).toBe(en.errors.SESSION_STOPPING);
  });
});
