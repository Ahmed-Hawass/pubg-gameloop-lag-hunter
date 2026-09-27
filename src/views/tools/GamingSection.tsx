// GamingSection.tsx — the gaming details page: seven live-mirrored
// switches. Owns its switch family (useTweaks), its reads, and its
// deep-link landing; the parent only routes which page shows.

import { useEffect, useRef, useState, type ReactNode, Fragment } from "react";
import {
  AlertTriangle,
  AppWindow,
  CheckCircle2,
  Expand,
  Gamepad2,
  Monitor,
  Mouse,
  SlidersHorizontal,
  Video,
  Zap,
} from "lucide-react";
import { EmptyState } from "../../components/components";
import type { Notice } from "../../errors";
import { useLang } from "../../i18n";
import { SwitchRow } from "./SwitchRow";
import { useTweaks } from "./useTweaks";

export function GamingSection(props: {
  active: boolean;
  /** deep-link row id (null = no link); "pagefile" belongs to storage */
  linkTarget: string | null;
  onLinkDone: () => void;
  showHint: (title: string, body: string) => void;
  failNotice: (notice: Notice | null) => void;
}) {
  const { active, linkTarget, onLinkDone, showHint, failNotice } = props;
  const { t } = useLang();
  const tweaks = useTweaks(failNotice);
  /** deep-link highlight row id: ringed for a moment, cleared with the link */
  const [linkedId, setLinkedId] = useState<string | null>(null);
  /** the details list element: the link landing scrolls within it */
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    // no fresh reads while a flip is in flight (the busy gate is a ref,
    // so this is exact even for a focus storm): the verified result is
    // the truth until it lands, and a mid-flip read could only paint
    // the pre-flip state over it
    if (tweaks.isBusy()) return;
    void tweaks.reloadSwitches();
    // the read contract is about a DETAILS page being visible, not the
    // tab alone; reload's identity is not part of the subscription contract
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // returning from Windows Settings (after flipping something by hand)
  // re-reads live: the switch must mirror what Windows says now.
  // Skipped mid-flip (same guard as the open effect): the UAC round-trip
  // always passes through the secure desktop, so a focus storm is
  // guaranteed exactly when a stale read would hurt most.
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

  // deep-link: a health card jumps to a row here. The parent opened this
  // page first (the open effect above fired the live read); this effect
  // scrolls once data arrives.
  useEffect(() => {
    if (!linkTarget || linkTarget === "pagefile" || !tweaks.ready) return;
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
  }, [linkTarget, tweaks.ready]);

  if (!tweaks.ready || tweaks.loadError) {
    // details wait for a real read: a dead shell must never show, and a
    // FAILED read surfaces as an honest error instead of an eternal
    // "Loading..." — the window-focus retry is the rescue
    const failed = tweaks.loadError !== null;
    return (
      <div className="check-list">
        <EmptyState
          icon={<SlidersHorizontal size={18} />}
          title={failed ? t.dialog.somethingWrong : t.loading}
          hint={tweaks.loadError ?? ""}
        />
      </div>
    );
  }

  /** one row per tweak: the attention section and the full archive
      render the SAME SwitchRow below (edit once, both follow). A row
      counts as needing attention only when rendered AND off: hidden
      rows do not exist, disabled rows wait on GameLoop. */
  type TweakRow = { id: string; off: boolean; el: ReactNode };
  const rows: TweakRow[] = [];
  if (tweaks.powerState !== "hidden") {
    rows.push({
      id: "powerplan",
      off: tweaks.powerState === "off",
      el: (
        <SwitchRow
          tweakId="powerplan"
          linked={linkedId === "powerplan"}
          on={tweaks.powerState === "on"}
          func={<Zap size={15} />}
          name={t.tweakPowerTitle}
          effect={t.tweakEffectNow}
          hintTitle={t.tweakPowerTitle}
          hintBody={t.tweakPowerHint}
          onHint={showHint}
          busy={tweaks.tweakBusy}
          onFlip={(next) => void tweaks.flipTweak("powerplan", next)}
        />
      ),
    });
  }
  if (tweaks.dvrOn !== null) {
    rows.push({
      id: "dvr",
      off: !tweaks.dvrOn,
      el: (
        <SwitchRow
          tweakId="dvr"
          linked={linkedId === "dvr"}
          on={tweaks.dvrOn}
          func={<Video size={15} />}
          name={t.tweakDvrTitle}
          effect={t.tweakEffectNow}
          hintTitle={t.tweakDvrTitle}
          hintBody={t.tweakDvrHint}
          onHint={showHint}
          busy={tweaks.tweakBusy}
          onFlip={(next) => void tweaks.flipTweak("dvr", next)}
        />
      ),
    });
  }
  if (tweaks.gameModeOn !== null) {
    rows.push({
      id: "gamemode",
      off: !tweaks.gameModeOn,
      el: (
        <SwitchRow
          tweakId="gamemode"
          linked={linkedId === "gamemode"}
          on={tweaks.gameModeOn}
          func={<Gamepad2 size={15} />}
          name={t.tweakGameModeTitle}
          hintTitle={t.tweakGameModeTitle}
          hintBody={t.tweakGameModeHint}
          onHint={showHint}
          busy={tweaks.tweakBusy}
          onFlip={(next) => void tweaks.flipTweak("gamemode", next)}
        />
      ),
    });
  }
  if (tweaks.fsoState !== "hidden") {
    rows.push({
      id: "fso",
      off: tweaks.fsoState === "off",
      el: (
        <SwitchRow
          tweakId="fso"
          linked={linkedId === "fso"}
          on={tweaks.fsoState === "on"}
          func={<Expand size={15} />}
          name={t.tweakFsoTitle}
          effect={t.tweakEffectReopen}
          hintTitle={t.tweakFsoTitle}
          hintBody={t.tweakFsoHint}
          onHint={showHint}
          busy={tweaks.tweakBusy}
          disabled={tweaks.fsoState === "disabled_gameloop_not_found"}
          disabledHint={t.tweakNeedsGameloop}
          onFlip={(next) => void tweaks.flipTweak("fso", next)}
        />
      ),
    });
  }
  if (tweaks.wgcOn !== null) {
    rows.push({
      id: "windowedopt",
      off: !tweaks.wgcOn,
      el: (
        <SwitchRow
          tweakId="windowedopt"
          linked={linkedId === "windowedopt"}
          on={tweaks.wgcOn}
          func={<AppWindow size={15} />}
          name={t.tweakWindowedTitle}
          effect={t.tweakEffectReopen}
          hintTitle={t.tweakWindowedTitle}
          hintBody={t.tweakWindowedHint}
          onHint={showHint}
          busy={tweaks.tweakBusy}
          onFlip={(next) => void tweaks.flipTweak("windowedopt", next)}
        />
      ),
    });
  }
  if (tweaks.gpuState !== "hidden") {
    rows.push({
      id: "gpupref",
      off: tweaks.gpuState === "off",
      el: (
        <SwitchRow
          tweakId="gpupref"
          linked={linkedId === "gpupref"}
          on={tweaks.gpuState === "on"}
          func={<Monitor size={15} />}
          name={t.tweakGpuTitle}
          effect={t.tweakEffectReopen}
          hintTitle={t.tweakGpuTitle}
          hintBody={t.tweakGpuHint}
          onHint={showHint}
          busy={tweaks.tweakBusy}
          disabled={tweaks.gpuState === "disabled_gameloop_not_found"}
          disabledHint={t.tweakNeedsGameloop}
          onFlip={(next) => void tweaks.flipTweak("gpupref", next)}
        />
      ),
    });
  }
  if (tweaks.mouseOn !== null) {
    rows.push({
      id: "mouse",
      off: !tweaks.mouseOn,
      el: (
        <SwitchRow
          tweakId="mouse"
          linked={linkedId === "mouse"}
          on={tweaks.mouseOn}
          func={<Mouse size={15} />}
          name={t.tweakMouseTitle}
          effect={t.tweakEffectSignin}
          hintTitle={t.tweakMouseTitle}
          hintBody={t.tweakMouseHint}
          onHint={showHint}
          busy={tweaks.tweakBusy}
          onFlip={(next) => void tweaks.flipTweak("mouse", next)}
        />
      ),
    });
  }
  const offRows = rows.filter((r) => r.off);

  return (
    <>
      {/* one-glance verdict, same pattern as the health tab: derived
          from the rendered rows, zero backend cost */}
      <div className={`health-banner ${offRows.length === 0 ? "ok" : "warn"}`}>
        {offRows.length === 0 ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
        <div>
          <div className="hb-title">
            {offRows.length === 0 ? t.tweakBannerGood : t.tweakBannerNeeds(offRows.length)}
          </div>
          <div className="hb-sub">
            {offRows.length === 0 ? t.tweakBannerGoodSub : t.tweakBannerNeedsSub}
          </div>
        </div>
      </div>

      {/* featured off-rows: the same rows as the archive below,
          repeated deliberately (summary + archive, not instead of it) */}
      {offRows.length > 0 ? (
        <section>
          <h3 className="health-section-title">{t.checkWarnBadge}</h3>
          <div className="check-list">
            {offRows.map((r) => (
              <Fragment key={`${r.id}-featured`}>{r.el}</Fragment>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h3 className="health-section-title">{t.tweakAllTweaks}</h3>
        <div className="check-list" ref={listRef}>
          {/* hidden until read; a feature the Windows build lacks stays
              hidden — a dead switch must never be shown. No area dividers:
              every row here targets gaming, subdivision would be noise. */}
          {rows.map((r) => (
            <Fragment key={`${r.id}-archive`}>{r.el}</Fragment>
          ))}
        </div>
      </section>
    </>
  );
}
