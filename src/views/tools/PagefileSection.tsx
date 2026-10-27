// PagefileSection.tsx - the virtual-memory details page: the editor,
// alone, under its own card. Split out of StorageSection so the page
// file owns its landing card and its deep-link; the editor itself owns
// its read and its state (this shell only gates the first paint and
// lands the health-card link).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { EmptyState } from "../../components/components";
import { LINK_HIGHLIGHT_MS, PageIntro } from "../../components/sections";
import type { Notice } from "../../errors";
import { useLang } from "../../i18n";
import { PagefileEditor } from "./PagefileEditor";

export function PagefileSection(props: {
  active: boolean;
  /** deep-link target (null = no link); only "pagefile" lands here */
  linkTarget: string | null;
  onLinkDone: () => void;
  failNotice: (notice: Notice | null) => void;
  /** back control from the shell, rendered at the header row end */
  headerTrail?: ReactNode;
}) {
  const { active, linkTarget, onLinkDone, failNotice, headerTrail } = props;
  const { t } = useLang();
  /** one-shot page guidance (the header keeps its title only): the
      why and the honest automatic default (owned by PageIntro below) */
  /** deep-link highlight: ringed for a moment, cleared with the link */
  const [linkedId, setLinkedId] = useState<string | null>(null);
  /** the details list element: the link landing scrolls within it */
  const listRef = useRef<HTMLDivElement>(null);
  /** page file read state for the joint gate (null = still pending).
      The editor itself owns the data and its inline error; this flag
      only tells the gate whether anything could load at all. */
  const [pfFailed, setPfFailed] = useState<boolean | null>(null);

  // deep-link: the health page file card jumps here. The page is
  // already open with its editor, so the landing scrolls to the card
  // and rings it once data arrives.
  useEffect(() => {
    if (linkTarget !== "pagefile") return;
    if (pfFailed === null) return;
    const card = listRef.current?.querySelector<HTMLElement>(`[data-tweak="pagefile"]`);
    if (!card) {
      onLinkDone();
      return;
    }
    setLinkedId("pagefile");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => {
      setLinkedId(null);
      onLinkDone();
    }, LINK_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
    // one-shot per link arrival, like the Reports openId effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkTarget, pfFailed]);

  // The editor mounts ALWAYS (even before its read lands): the gate
  // below waits on the editor's own settled signal, so gating the
  // editor behind it would deadlock - a spinner with nothing reading
  // behind it, forever. The editor renders nothing until its read
  // lands, so the spinner is the only visible thing meanwhile.
  return (
    <div className="check-list" ref={listRef}>
      {/* standing page header plus the one-shot card below it (the
          header keeps the section name with its short scope line; the
          card keeps the friendly title and the full guidance) */}
      <PageIntro
        id="pagefile"
        headerTitle={t.tweakPfTitle}
        headerSub={t.toolPagefileDesc}
        cardTitle={t.introPagefileTitle}
        cardBody={t.introPagefileBody}
        headerTrail={headerTrail}
      />
      {pfFailed === null ? (
        <EmptyState
          icon={<RotateCw size={18} />}
          title={t.loading}
          hint=""
          spin
        />
      ) : null}
      <PagefileEditor
        active={active}
        linkedId={linkedId}
        onPfSettled={setPfFailed}
        failNotice={failNotice}
      />
    </div>
  );
}
