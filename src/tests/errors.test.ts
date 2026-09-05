// errors.test.ts — the dialog mapping users see when a scan fails.

import { describe, expect, it } from "vitest";
import { errorDialog } from "../errors";
import { en } from "../locales/en";

const COPY = {
  somethingWrong: en.dialog.somethingWrong,
  scanNeedsGame: en.dialog.scanNeedsGame,
  scanNeedsGameBody: en.dialog.scanNeedsGameBody,
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

  it("unknown errors show the raw message under the generic title", () => {
    const d = errorDialog("some novel failure", en.errors, COPY);
    expect(d.title).toBe(en.dialog.somethingWrong);
    expect(d.body).toBe("some novel failure");
    expect(d.key).toBe("some novel failure");
  });
});
