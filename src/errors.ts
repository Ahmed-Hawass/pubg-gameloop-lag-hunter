// errors.ts — map a backend error string to the dialog the user should see.
// Extracted verbatim from App.tsx's toggle() so the decision is testable:
// a known code gets its copy; GAMELOOP_NOT_RUNNING gets the friendly dialog;
// anything else shows the raw message under the generic title.

export interface ErrorDialog {
  /** dialog title */
  title: string;
  /** dialog body */
  body: string;
  /** dialog identity key (single modal surface, never a toast) */
  key: string;
}

/** an informational or failure notice on the single modal surface */
export interface Notice {
  title: string;
  body: string;
}

/**
 * Decide which dialog a thrown backend error maps to.
 * `raw` is the error as string; `errors` is the locale's error-code table;
 * `copy` carries the locale's titles (somethingWrong / scanNeedsGame pair
 * plus the unknown-error body: a novel Rust message must never ship raw
 * English into an Arabic dialog — the locale explains, the raw string
 * rides along as a technical line).
 */
export function errorDialog(
  raw: string,
  errors: Record<string, string>,
  copy: {
    somethingWrong: string;
    scanNeedsGame: string;
    scanNeedsGameBody: string;
    unknownErrorBody: (raw: string) => string;
  },
): ErrorDialog {
  const code = Object.keys(errors).find((c) => raw.includes(c));
  if (code === "GAMELOOP_NOT_RUNNING") {
    return { title: copy.scanNeedsGame, body: copy.scanNeedsGameBody, key: code };
  }
  if (code) {
    return { title: copy.somethingWrong, body: errors[code], key: code };
  }
  return {
    title: copy.somethingWrong,
    body: copy.unknownErrorBody(raw),
    key: raw,
  };
}
