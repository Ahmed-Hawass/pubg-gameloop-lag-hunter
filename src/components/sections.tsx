// sections.tsx — shared page-section shapes: the one-glance verdict
// banner and the featured-plus-archive list shared by Checks, Gaming,
// and Storage, plus the one-shot page intro (with its plain-header
// fallback). Three copies of each lived in the views; edit once here
// and all follow. Class names stay identical, so no test or style
// changes ride along.

import { Fragment, type ReactNode, type RefObject } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { IntroCard } from "./components";
import { useLang } from "../i18n";
import { useIntroCard } from "../useIntroCard";

/** one-glance verdict: icon plus title plus sub, tone by the count. */
export function VerdictBanner(props: { ok: boolean; title: string; sub: string }) {
  const { ok, title, sub } = props;
  return (
    <div className={`health-banner ${ok ? "ok" : "warn"}`}>
      {ok ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
      <div>
        <div className="hb-title">{title}</div>
        <div className="hb-sub">{sub}</div>
      </div>
    </div>
  );
}

/** one attention row: the caller owns the element, this owns the keys
    (featured and archive suffixes can never collide or drift). */
export interface AttentionRow {
  id: string;
  el: ReactNode;
}

/** featured warnings above the full archive (summary plus archive, never
    instead of it). Visibility of the whole block stays with the caller
    (Storage hides its archive while unread); an empty warn list hides
    the featured section everywhere. */
export function SummaryArchive(props: {
  warnTitle: string;
  archiveTitle: string;
  warn: AttentionRow[];
  all: AttentionRow[];
  /** extra archive tail (revealed-unsupported rows): caller-keyed */
  tail?: ReactNode;
  listRef?: RefObject<HTMLDivElement | null>;
}) {
  const { warnTitle, archiveTitle, warn, all, tail, listRef } = props;
  return (
    <>
      {warn.length > 0 ? (
        <section>
          <h3 className="health-section-title">{warnTitle}</h3>
          <div className="check-list">
            {warn.map((r) => (
              <Fragment key={`${r.id}-featured`}>{r.el}</Fragment>
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <h3 className="health-section-title">{archiveTitle}</h3>
        <div className="check-list" ref={listRef}>
          {all.map((r) => (
            <Fragment key={`${r.id}-archive`}>{r.el}</Fragment>
          ))}
          {tail}
        </div>
      </section>
    </>
  );
}

/** one-shot page guidance: the intro card while unseen, the plain page
    header (or nothing) once dismissed. Replaces the identical
    hook-plus-conditional in Processes, Pagefile, and Sweep. Mount-timing
    contract: use only where no early return precedes it (the hook must
    fire on mount, not one tick after the data lands, or the card pops
    in late — ChecksView keeps its own top-level call for this reason). */
export function PageIntro(props: {
  id: string;
  icon: ReactNode;
  title: string;
  body: string;
  fallback?: ReactNode;
}) {
  const { id, icon, title, body, fallback } = props;
  const { t } = useLang();
  const intro = useIntroCard(id);
  if (intro.show) {
    return (
      <IntroCard
        icon={icon}
        title={title}
        body={body}
        dismissLabel={t.dialog.dismiss}
        onDismiss={intro.dismiss}
      />
    );
  }
  return <>{fallback ?? null}</>;
}
