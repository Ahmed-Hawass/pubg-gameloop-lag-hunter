// StorageSection.tsx — the storage details page: page file editor,
// Storage Sense switch, and manual sweep. Composes the two editors (each
// owns its read and its state) plus the single switch row that lives on
// this page. The joint gate below mirrors the old whole-page contract:
// a spinner until the first read lands anywhere, an error page only when
// nothing useful could load at all.

import { useCallback, useEffect, useRef, useState } from "react";
import { Recycle, RefreshCw, SlidersHorizontal } from "lucide-react";
import { EmptyState } from "../../components/components";
import type { Notice } from "../../errors";
import { useLang } from "../../i18n";
import { PagefileEditor } from "./PagefileEditor";
import { SweepSection } from "./SweepSection";
import { SwitchRow } from "./SwitchRow";
import { useTweaks } from "./useTweaks";

export function StorageSection(props: {
  active: boolean;
  /** deep-link target (null = no link); row ids and "pagefile" land here */
  linkTarget: string | null;
  onLinkDone: () => void;
  showHint: (title: string, body: string) => void;
  failNotice: (notice: Notice | null) => void;
  /** reports cleanup activity to the shell (the exit confirm needs it) */
  onCleaningChange?: (active: boolean) => void;
}) {
  const { active, linkTarget, onLinkDone, showHint, failNotice, onCleaningChange } = props;
  const { t } = useLang();
  const tweaks = useTweaks(failNotice);
  /** deep-link highlight row id: ringed for a moment, cleared with the link */
  const [linkedId, setLinkedId] = useState<string | null>(null);
  /** the details list element: the link landing scrolls within it */
  const listRef = useRef<HTMLDivElement>(null);
  /** page file read state for the joint gate (null = still pending).
      The editor itself owns the data and its inline error; this flag
      only tells the gate whether anything could load at all. */
  const [pfFailed, setPfFailed] = useState<boolean | null>(null);
  const onPfSettled = useCallback((failed: boolean) => {
    setPfFailed(failed);
  }, []);

  useEffect(() => {
    if (!active) return;
    // same no-mid-flip-read rule as the gaming page: the verified result
    // is the truth until it lands
    if (tweaks.isBusy()) return;
    void tweaks.reloadSwitches();
    // the read contract is about this DETAILS page being visible;
    // reload's identity is not part of the subscription contract
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onFocus = () => {
      if (tweaks.isBusy()) return;
      void tweaks.reloadSwitches();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // same as above: reload's identity is not part of the subscription
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // deep-link: this page owns every non-gaming target (a switch row,
  // the page file summary, or the sweep summary). The editor opens for
  // "pagefile" first (its summary alone would hide what the card
  // promised), then the shared landing scrolls to whatever matched.
  // Gaming targets belong to the other page: the parent routes there,
  // so a transient gaming target here yields without touching anything.
  useEffect(() => {
    if (!linkTarget) return;
    const wantCard = linkTarget === "pagefile" ? "storage" : "gaming";
    if (wantCard !== "storage") return;
    if (pfFailed === null && !tweaks.ready) return;
    const target = linkTarget;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-tweak="${target}"]`);
    if (!row) {
      // the linked row is not rendered on this machine (hidden, not
      // disabled): clear the link instead of re-firing on every visit
      onLinkDone();
      return;
    }
    setLinkedId(target);
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row
      .querySelector<HTMLButtonElement>("button.switch, button.pf-name-btn")
      ?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => {
      setLinkedId(null);
      onLinkDone();
    }, 2200);
    return () => window.clearTimeout(timer);
    // one-shot per link arrival, like the Reports openId effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkTarget, pfFailed, tweaks.ready]);

  const swFailed = tweaks.loadError !== null;
  if (pfFailed === null && !tweaks.ready) {
    // nothing has landed anywhere yet: the loading shell, never a dead
    // page and never an error for a read still in flight
    return (
      <div className="check-list">
        <EmptyState
          icon={<RefreshCw size={20} />}
          title={t.loading}
          hint=""
          spin
        />
      </div>
    );
  }
  if (swFailed && pfFailed) {
    // both reads failed: an honest error page (the window-focus retry
    // is the rescue). A single failure degrades per part instead: the
    // editor's inline error, or a hidden switch row.
    return (
      <div className="check-list">
        <EmptyState
          icon={<SlidersHorizontal size={18} />}
          title={t.dialog.somethingWrong}
          hint={tweaks.loadError ?? ""}
        />
      </div>
    );
  }

  return (
    <div className="check-list" ref={listRef}>
      <PagefileEditor
        active={active}
        linkedId={linkedId}
        linkActive={linkTarget === "pagefile"}
        onPfSettled={onPfSettled}
        showHint={showHint}
        failNotice={failNotice}
      />
      {tweaks.ssOn !== null ? (
        <SwitchRow
          tweakId="storagesense"
          linked={linkedId === "storagesense"}
          on={tweaks.ssOn}
          func={<Recycle size={15} />}
          name={t.tweakSsTitle}
          hintTitle={t.tweakSsTitle}
          hintBody={t.tweakSsHint}
          onHint={showHint}
          busy={tweaks.tweakBusy}
          onFlip={(next) => void tweaks.flipTweak("storagesense", next)}
        />
      ) : null}
      <SweepSection
        showHint={showHint}
        failNotice={failNotice}
        onCleaningChange={onCleaningChange}
      />
    </div>
  );
}
