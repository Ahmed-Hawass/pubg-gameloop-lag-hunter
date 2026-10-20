// errors.test.ts — the dialog mapping users see when a scan fails.

import { describe, expect, it } from "vitest";
import { errorDialog, findErrorCode } from "../errors";
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

  it("maps a missing install to its own copy, never the start-the-game gate", () => {
    const d = errorDialog("GAMELOOP_NOT_INSTALLED", en.errors, COPY);
    expect(d.title).toBe(en.dialog.somethingWrong);
    expect(d.body).toBe(en.errors.GAMELOOP_NOT_INSTALLED);
    expect(d.key).toBe("GAMELOOP_NOT_INSTALLED");
  });

  it("maps an unrecognized emulator build to its honest copy, never the game gate", () => {
    // EMULATOR_UNKNOWN must not collapse into GAMELOOP_NOT_RUNNING: the
    // game may well be running under a build we have no card for
    const d = errorDialog("EMULATOR_UNKNOWN", en.errors, COPY);
    expect(d.title).toBe(en.dialog.somethingWrong);
    expect(d.body).toBe(en.errors.EMULATOR_UNKNOWN);
    expect(d.key).toBe("EMULATOR_UNKNOWN");
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

describe("findErrorCode", () => {
  it("reads the backend's own error string as the code", () => {
    expect(findErrorCode("GAMELOOP_NOT_RUNNING", en.errors)).toBe("GAMELOOP_NOT_RUNNING");
  });

  it("reads a code that stands alone inside a longer message", () => {
    expect(findErrorCode("engine error: SESSION_STOPPING (wait)", en.errors)).toBe(
      "SESSION_STOPPING",
    );
  });

  it("does not read a code that is glued to another word", () => {
    // a substring match would have picked SESSION_STOPPING out of this
    // and shown advice about a state the user never hit
    expect(findErrorCode("SESSION_STOPPINGX", en.errors)).toBeUndefined();
    expect(findErrorCode("XSESSION_STOPPING", en.errors)).toBeUndefined();
  });

  it("does not read a code that is merely mentioned in prose", () => {
    expect(findErrorCode("the engine reported GAMELOOP_NOT_RUNNING earlier", en.errors)).toBe(
      "GAMELOOP_NOT_RUNNING",
    );
    // ...but a code glued to a word is not a mention
    expect(findErrorCode("errorGAMELOOP_NOT_RUNNING", en.errors)).toBeUndefined();
  });

  it("returns nothing for a message with no code at all", () => {
    expect(findErrorCode("some novel failure", en.errors)).toBeUndefined();
  });

  it("the longer of two similar codes wins", () => {
    // gpu_activity_cliff is a PREFIX of gpu_activity_cliff_loaded, and the
    // shorter one comes first in the table: a plain substring match shows
    // the wrong copy for the longer one
    expect(findErrorCode("gpu_activity_cliff_loaded", en.highlights)).toBe(
      "gpu_activity_cliff_loaded",
    );
    expect(findErrorCode("gpu_activity_cliff", en.highlights)).toBe("gpu_activity_cliff");
    // and inside a longer message the longer code still wins
    expect(findErrorCode("event: gpu_activity_cliff_loaded", en.highlights)).toBe(
      "gpu_activity_cliff_loaded",
    );
  });

  it("no error code is a prefix of another (the table stays unambiguous)", () => {
    // the error table is matched by whole token; two codes where one is a
    // prefix of the other would make the shorter one unreachable
    const keys = Object.keys(en.errors);
    for (const a of keys) {
      for (const b of keys) {
        if (a !== b) {
          expect(b.startsWith(a), `${a} is a prefix of ${b}`).toBe(false);
        }
      }
    }
  });
});
