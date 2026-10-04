// useIntroCard.ts — one-shot page guidance gating: shown until the user
// presses X, then never again on this machine. Recorded at DISMISS time
// (unlike the advice modals, which record at show because any click
// dismisses them): a card must survive until the explicit close. The
// read hides the card until known (same defer-to-IPC rule as the
// sidebar and welcome: a dismissed card must never flash); an unreadable
// read shows it (guidance harms nothing), and a failed persist rolls it
// visibly back instead of lying.

import { useCallback, useEffect, useState } from "react";
import { api } from "./bridge";

/** local signal: the dismissal list changed elsewhere (the Settings
    reset action) — mounted sections re-read instead of waiting for a
    remount that never comes (views stay alive across tab switches).
    Same local-event family as the feature-state signal. */
export const INTRO_CARDS_EVENT = "laghunter:intro-cards-changed";

export function useIntroCard(id: string): { show: boolean; dismiss: () => void } {
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => {
      void api
        .getSettings()
        .then((s) => {
          if (live) setDismissed(s.dismissed_cards ?? []);
        })
        .catch(() => {
          if (live) setDismissed([]);
        });
    };
    read();
    window.addEventListener(INTRO_CARDS_EVENT, read);
    return () => {
      live = false;
      window.removeEventListener(INTRO_CARDS_EVENT, read);
    };
  }, []);
  const dismiss = useCallback(() => {
    // optimistic hide: the X answers instantly, the write follows
    setDismissed((prev) => (prev === null ? prev : [...prev, id]));
    void api.dismissIntroCard(id).catch(() => {
      // storage failed: the card comes back instead of a silent lie
      setDismissed((prev) => (prev ?? []).filter((d) => d !== id));
    });
  }, [id]);
  return { show: dismissed !== null && !dismissed.includes(id), dismiss };
}
