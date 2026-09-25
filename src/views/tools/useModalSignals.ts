// useModalSignals.ts — the two global modal-surface signals every Tools
// section shares: announce our dialogs so parked tooltips hide, and yield
// our dialogs when the app-level dialog opens (one overlay at a time).

import { useEffect } from "react";
import {
  APP_DIALOG_OPEN_EVENT,
  MODAL_OPEN_EVENT,
} from "../../components/components";

/** announce an open dialog so every tooltip hides (a dialog mounting
    under a parked cursor never fires mouseleave) */
export function useModalSignal(open: boolean) {
  useEffect(() => {
    if (open) window.dispatchEvent(new Event(MODAL_OPEN_EVENT));
  }, [open]);
}

/** close our dialog when the app-level dialog opens: two overlays would
    share one Escape keydown. The yielded dialog is always re-askable. */
export function useYieldToAppDialog(open: boolean, onYield: () => void) {
  useEffect(() => {
    if (!open) return;
    window.addEventListener(APP_DIALOG_OPEN_EVENT, onYield);
    return () => window.removeEventListener(APP_DIALOG_OPEN_EVENT, onYield);
  }, [open, onYield]);
}
