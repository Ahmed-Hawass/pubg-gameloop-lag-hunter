// StorageSection.tsx — the storage details page: live-mirrored option
// rows under a one-glance banner like the gaming page. The full general
// pattern holds (banner, featured attention, full archive): future
// options join the rows below, nothing restructures. The rows own
// their read through useTweaks; this shell only gates the first paint.

import { useEffect, type ReactNode } from "react";
import { Recycle, RefreshCw, SlidersHorizontal } from "lucide-react";
import { EmptyState } from "../../components/components";
import { PageIntro, SummaryArchive, VerdictBanner } from "../../components/sections";
import { useIntervalTick, BACKSTOP_POLL_MS } from "../../useIntervalTick";
import type { Notice } from "../../errors";
import { useLang } from "../../i18n";
import { SwitchRow } from "./SwitchRow";
import { useTweaks } from "./useTweaks";

export function StorageSection(props: {
  active: boolean;
  showHint: (title: string, body: string) => void;
  failNotice: (notice: Notice | null) => void;
  /** back control from the shell, rendered at the header row end */
  headerTrail?: ReactNode;
}) {
  const { active, showHint, failNotice, headerTrail } = props;
  const { t } = useLang();
  const tweaks = useTweaks(failNotice);

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

  // slow backstop poll, same contract as the gaming page: external
  // changes while open must surface within a minute, cheaply.
  useIntervalTick(
    active,
    BACKSTOP_POLL_MS,
    () => {
      if (tweaks.isBusy()) return;
      void tweaks.reloadSwitches();
    },
  );

  if (!tweaks.ready) {
    // nothing has landed yet: the loading shell, never a dead page
    // and never an error for a read still in flight (a failed read
    // below degrades to an honest error page instead)
    const failed = tweaks.loadError !== null;
    return (
      <div className="check-list">
        <PageIntro
          id="storage"
          headerTitle={t.toolStorage}
          headerSub={t.toolStorageDesc}
          cardTitle={t.introStorageTitle}
          cardBody={t.introStorageBody}
          headerTrail={headerTrail}
        />
        <EmptyState
          icon={failed ? <SlidersHorizontal size={18} /> : <RefreshCw size={18} />}
          title={failed ? t.dialog.somethingWrong : t.loading}
          hint={failed ? (tweaks.loadError ?? "") : ""}
          spin={!failed}
        />
      </div>
    );
  }

  /** one row per storage option: the attention section and the full
      archive render the SAME row below (edit once, both follow). A row
      counts as needing attention only when rendered AND off — the same
      rule as the gaming page, so future options slot in untouched. */
  type StorageRow = { id: string; off: boolean; el: ReactNode };
  const rows: StorageRow[] = [];
  if (tweaks.ssOn !== null) {
    rows.push({
      id: "storagesense",
      off: !tweaks.ssOn,
      el: (
        <SwitchRow
          tweakId="storagesense"
          linked={false}
          on={tweaks.ssOn}
          func={<Recycle size={15} />}
          name={t.tweakSsTitle}
          hintTitle={t.tweakSsTitle}
          hintBody={t.tweakSsHint}
          onHint={showHint}
          busy={tweaks.tweakBusy}
          onFlip={(next) => void tweaks.flipTweak("storagesense", next)}
        />
      ),
    });
  }
  const offRows = rows.filter((r) => r.off);

  return (
    <>
      {/* standing page header plus the one-shot card below it (the
          header keeps the section name; the card keeps its own
          friendly title, never the same words twice) */}
      <PageIntro
        id="storage"
        headerTitle={t.toolStorage}
        headerSub={t.toolStorageDesc}
        cardTitle={t.introStorageTitle}
        cardBody={t.introStorageBody}
        headerTrail={headerTrail}
      />
      {/* one-glance verdict, same pattern as the gaming page: derived
          from the rendered rows, zero backend cost. Hidden while
          unread (a badge that cannot be read is hidden, like every
          landing badge). */}
      {rows.length > 0 ? (
        <VerdictBanner
          ok={offRows.length === 0}
          title={offRows.length === 0 ? t.tweakBannerGood : t.tweakBannerNeeds(offRows.length)}
          sub={offRows.length === 0 ? t.tweakBannerGoodSub : t.tweakBannerNeedsSub}
        />
      ) : null}
      {/* featured off-rows: the same rows as the archive below,
          repeated deliberately (summary plus archive, not instead of it) */}
      {rows.length > 0 ? (
        <SummaryArchive
          warnTitle={t.checkWarnBadge}
          archiveTitle={t.storageAllTitle}
          warn={offRows.map((r) => ({ id: r.id, el: r.el }))}
          all={rows.map((r) => ({ id: r.id, el: r.el }))}
        />
      ) : null}
    </>
  );
}
