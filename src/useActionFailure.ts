// useActionFailure.ts - the one way a view says "the action failed": a
// notice on the single modal surface, never a toast and never a silent
// no-op. A failed action explains itself in a dialog (the app's own rule:
// failed actions explain in a dialog, failed page loads show a retry).
//
// It exists so the rule is written once: every view that fires a command
// the user can see failing (open a link, open a Windows page, open the
// download folder) uses this hook instead of `void api.x()` with no
// catch - a failed command used to look exactly like a button that does
// nothing.

import { useCallback, useState } from "react";
import { errorDialog, type ErrorLocale, type Notice } from "./errors";

export function useActionFailure(t: ErrorLocale): {
  notice: Notice | null;
  /** hand it a caught error: it maps to the right dialog copy */
  onFailure: (e: unknown) => void;
  clear: () => void;
} {
  const [notice, setNotice] = useState<Notice | null>(null);
  const onFailure = useCallback(
    (e: unknown) => {
      const msg = typeof e === "string" ? e : String(e);
      const d = errorDialog(msg, t.errors, {
        somethingWrong: t.dialog.somethingWrong,
        scanNeedsGame: t.dialog.scanNeedsGame,
        scanNeedsGameBody: t.dialog.scanNeedsGameBody,
        unknownErrorBody: t.dialog.unknownErrorBody,
      });
      setNotice({ title: d.title, body: d.body });
    },
    [t],
  );
  const clear = useCallback(() => setNotice(null), []);
  return { notice, onFailure, clear };
}
