// PagefileSection.tsx — the virtual-memory details page: the editor,
// alone, under its own card. Split out of StorageSection so the page
// file owns its landing card and its deep-link; the editor itself owns
// its read and its state (this shell only gates the first paint and
// lands the health-card link).

import { useEffect, useRef, useState } from "react";
import { Database, RefreshCw } from "lucide-react";
import { EmptyState, IntroCard } from "../../components/components";
import type { Notice } from "../../errors";
import { useLang } from "../../i18n";
import { useIntroCard } from "../../useIntroCard";
import { PagefileEditor } from "./PagefileEditor";

export function PagefileSection(props: {
  active: boolean;
  /** deep-link target (null = no link); only "pagefile" lands here */
  linkTarget: string | null;
  onLinkDone: () => void;
  showHint: (title: string, body: string) => void;
  failNotice: (notice: Notice | null) => void;
}) {
  const { active, linkTarget, onLinkDone, showHint, failNotice } = props;
  const { t } = useLang();
  /** one-shot page guidance (the header keeps its title only): the
      why and the honest automatic default */
  const intro = useIntroCard("pagefile");
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
    }, 2200);
    return () => window.clearTimeout(timer);
    // one-shot per link arrival, like the Reports openId effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkTarget, pfFailed]);

  // The editor mounts ALWAYS (even before its read lands): the gate
  // below waits on the editor's own settled signal, so gating the
  // editor behind it would deadlock — a spinner with nothing reading
  // behind it, forever. The editor renders nothing until its read
  // lands, so the spinner is the only visible thing meanwhile.
  return (
    <div className="check-list" ref={listRef}>
      {/* one header per page, always: the intro card replaces the plain
          page header until dismissed (it carries its own icon and title,
          a second header under it would only repeat both) */}
      {intro.show ? (
        <IntroCard
          icon={<Database size={16} />}
          title={t.introPagefileTitle}
          body={t.introPagefileBody}
          dismissLabel={t.dialog.dismiss}
          onDismiss={intro.dismiss}
        />
      ) : (
        /* plain page header (not a card, not collapsible): the shell
           back button above already says where this lives */
        <div className="page-head">
          <span className="icon-tile">
            <Database size={18} />
          </span>
          <span className="page-head-text">
            <span className="page-head-title">{t.tweakPfTitle}</span>
          </span>
        </div>
      )}
      {pfFailed === null ? (
        <EmptyState
          icon={<RefreshCw size={20} />}
          title={t.loading}
          hint=""
          spin
        />
      ) : null}
      <PagefileEditor
        active={active}
        linkedId={linkedId}
        onPfSettled={setPfFailed}
        showHint={showHint}
        failNotice={failNotice}
      />
    </div>
  );
}
