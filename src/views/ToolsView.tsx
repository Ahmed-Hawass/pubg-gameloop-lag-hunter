// ToolsView.tsx — one "System tweaks" list holding every toggle, grouped
// by area. A switch MIRRORS THE LIVE RESULT of its named action (ON = the
// action holds right now, whoever made it hold), so manual changes outside
// the app appear on the next fresh read: opening the view and regaining
// window focus both read fresh, bypassing the cache.
import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, Recycle, SlidersHorizontal, Video } from "lucide-react";
import { Dialog, EmptyState, MODAL_OPEN_EVENT } from "../components/components";
import { api, type SystemChecks } from "../bridge";
import { useLang } from "../i18n";
import spotTweaksDark from "../assets/spot-system-tweaks-dark.svg?url";
import spotTweaksLight from "../assets/spot-system-tweaks-light.svg?url";

/** one switch row. The switch mirrors the live RESULT of the named action
    (ON = the action holds right now). The label names the action itself
    ("Turn off X"), so ON is always the recommended state by construction:
    the row carries the same verdict language as System health (accent edge
    + badge), both driven by the optimistic `on` prop so they flip instantly
    with the switch and roll back with it on failure. */
function SwitchRow(props: {
  on: boolean;
  func: ReactNode;
  name: string;
  desc: string;
  busy: boolean;
  onFlip: (next: boolean) => void;
}) {
  const { t } = useLang();
  const { on, func, name, desc, busy, onFlip } = props;
  return (
    <div className={`switch-row ${on ? "on" : "off"}`}>
      <span className="check-func">{func}</span>
      <div className="switch-body">
        <span className="switch-name">{name}</span>
        <span className="switch-desc">{desc}</span>
      </div>
      <span className={`check-badge ${on ? "ok" : "warn"}`}>
        {on ? t.checkOkBadge : t.checkWarnBadge}
      </span>
      <button
        role="switch"
        aria-checked={on}
        aria-label={name}
        className="switch"
        disabled={busy}
        onClick={() => void onFlip(!on)}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}

export function ToolsView(props: { active: boolean }) {
  const { active } = props;
  const { t } = useLang();
  /** details page open (the landing card was pressed) */
  const [open, setOpen] = useState(false);
  const [checks, setChecks] = useState<SystemChecks | null>(null);
  /** optimistic switch positions: flip instantly on click; restored to the
      verified live truth after the write settles (and on every fresh read) */
  const [dvrOn, setDvrOn] = useState<boolean | null>(null);
  const [ssOn, setSsOn] = useState<boolean | null>(null);
  /** failed-write notice body (null = no notice) */
  const [notice, setNotice] = useState<string | null>(null);
  const [tweakBusy, setTweakBusy] = useState(false);
  /** true once a fresh read has landed (landing card renders instantly,
      details wait for real data instead of showing a dead shell) */
  const [loaded, setLoaded] = useState(false);

  /** fresh statuses, bypassing the cache: Windows is the single source of
      truth, so every entry point (open the view / window focus) re-reads
      live — manual changes outside the app must be picked up here */
  const reload = async () => {
    try {
      const c = await api.systemChecks(true);
      setChecks(c);
      setDvrOn(!c.game_dvr_enabled);
      setSsOn(c.storage_sense);
      setLoaded(true);
    } catch {
      // stale view keeps showing; the landing card needs no data
    }
  };

  useEffect(() => {
    if (!active) return;
    void reload();
  }, [active]);

  // returning from Windows Settings (after flipping something by hand)
  // re-reads live: the switch must mirror what Windows says now
  useEffect(() => {
    if (!active) return;
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [active]);

  // a dialog mounting under a parked cursor never fires mouseleave — tell
  // every tooltip to hide the moment ours opens (same signal as the shell)
  useEffect(() => {
    if (notice) {
      window.dispatchEvent(new Event(MODAL_OPEN_EVENT));
    }
  }, [notice]);

  /** every toggle in one table: how to read the switch from the live
      statuses, how to move it, and the registry value each direction
      writes. Adding a tweak = one row here + one SwitchRow below. */
  const TWEAKS = {
    dvr: {
      goal: (on: boolean): 0 | 1 => (on ? 0 : 1), // ON = recording off
      set: setDvrOn,
      get: () => dvrOn,
    },
    storagesense: {
      goal: (on: boolean): 0 | 1 => (on ? 1 : 0), // ON = cleanup on
      set: setSsOn,
      get: () => ssOn,
    },
  } as const;
  type TweakId = keyof typeof TWEAKS;

  /** generic flip: optimistic move, explicit write both directions,
      verified live truth settles the final position */
  const flipTweak = async (id: TweakId, on: boolean) => {
    const tweak = TWEAKS[id];
    if (tweakBusy) return;
    const before = tweak.get();
    if (before === null) return; // feature unavailable or not read yet
    tweak.set(on); // optimistic: the switch answers instantly
    setTweakBusy(true);
    try {
      const res = await api.setTweak(id, tweak.goal(on));
      if (!res.verified) {
        tweak.set(before); // roll back to the truth we knew
        setNotice(t.tweakFailed);
        return;
      }
      await reload(); // settle on the verified live state
    } catch (e) {
      tweak.set(before);
      setNotice(typeof e === "string" ? e : String(e));
    } finally {
      setTweakBusy(false);
    }
  };

  if (open) {
    if (!checks || !loaded) {
      // details wait for a real read: a dead shell must never show, and a
      // failed read surfaces as an honest error instead of silent nothing
      return (
        <div className="tools">
          <button className="tools-back" onClick={() => setOpen(false)}>
            <ChevronLeft size={16} />
            {t.toolsBack}
          </button>
          <EmptyState
            icon={<SlidersHorizontal size={18} />}
            title={loaded ? t.dialog.somethingWrong : t.loading}
            hint=""
          />
        </div>
      );
    }
    return (
      <div className="tools">
        <button className="tools-back" onClick={() => setOpen(false)}>
          <ChevronLeft size={16} />
          {t.toolsBack}
        </button>
        <div className="check-list">
          <div className="tweak-group">{t.toolGaming}</div>
          {/* hidden until read; a feature the Windows build lacks stays
              hidden — a dead switch must never be shown */}
          {dvrOn !== null ? (
            <SwitchRow
              on={dvrOn}
              func={<Video size={15} />}
              name={t.tweakDvrTitle}
              desc={t.tweakDvrDesc}
              busy={tweakBusy}
              onFlip={(next) => void flipTweak("dvr", next)}
            />
          ) : null}
          <div className="tweak-group">{t.toolStorage}</div>
          {/* hidden when the Windows build has no Storage Sense policy
              key (checks.storage_sense === null): never a dead switch */}
          {ssOn !== null ? (
            <SwitchRow
              on={ssOn}
              func={<Recycle size={15} />}
              name={t.tweakSsTitle}
              desc={t.tweakSsDesc}
              busy={tweakBusy}
              onFlip={(next) => void flipTweak("storagesense", next)}
            />
          ) : null}
        </div>
        {/* failed write — the unified Dialog, notice only (the flip itself
            is the consent, there is no confirm step) */}
        {notice ? (
          <Dialog
            title={t.dialog.somethingWrong}
            body={notice}
            kind="notice"
            okLabel={t.dialog.ok}
            onClose={() => setNotice(null)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="tools">
      <p className="checks-hint">{t.toolsHint}</p>
      <div className="tools-grid">
        <button className="tool-card" onClick={() => setOpen(true)}>
          <img
            className="tool-spot"
            src={document.documentElement.dataset.theme === "light" ? spotTweaksLight : spotTweaksDark}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <span className="tool-title">{t.toolSystemTweaks}</span>
          <span className="tool-desc">{t.toolSystemTweaksDesc}</span>
        </button>
      </div>
    </div>
  );
}
