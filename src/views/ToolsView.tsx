// ToolsView.tsx — one card per area (Gaming tweaks, Storage), each opening
// its own details list. A switch MIRRORS THE LIVE RESULT of its named action
// (ON = the action holds right now, whoever made it hold), so manual changes
// outside the app appear on the next fresh read: opening a details page and
// regaining window focus both re-read live. The read is the lightweight
// tweak_states command (a handful of registry values, microseconds) — never the
// full system_checks batch, whose rows this page does not display.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, Expand, Gamepad2, Info, Monitor, Mouse, Recycle, SlidersHorizontal, Video, AppWindow } from "lucide-react";
import { Dialog, EmptyState, MODAL_OPEN_EVENT, APP_DIALOG_OPEN_EVENT } from "../components/components";
import { api, type RowState } from "../bridge";
import { useLang } from "../i18n";
import spotTweaksDark from "../assets/spot-system-tweaks-dark.svg?url";
import spotTweaksLight from "../assets/spot-system-tweaks-light.svg?url";
import spotStorageDark from "../assets/spot-storage-dark.svg?url";
import spotStorageLight from "../assets/spot-storage-light.svg?url";

/** one switch row. The switch mirrors the live RESULT of the named action
    (ON = the action holds right now). The label names the action itself
    ("Turn off X"), so ON is always the recommended state by construction:
    the row carries the same verdict language as System health (accent edge
    + badge), both driven by the optimistic `on` prop so they flip instantly
    with the switch and roll back with it on failure. */
function SwitchRow(props: {
  /** stable row id: deep-link target (data-tweak) + highlight match */
  tweakId: string;
  on: boolean;
  func: ReactNode;
  name: string;
  desc: string;
  /** background note behind the (?) button (plain language, never a
      substitute for the desc above) */
  hintTitle: string;
  hintBody: string;
  onHint: (title: string, body: string) => void;
  /** the health-card deep-link landed on this row: temporary ring */
  linked: boolean;
  busy: boolean;
  onFlip: (next: boolean) => void;
  /** greyed, non-clickable row with a translated reason underneath —
      for preconditions the user can fix (vs hidden, for rows that can
      never work here) */
  disabled?: boolean;
  disabledHint?: string;
}) {
  const { t } = useLang();
  const { tweakId, on, func, name, desc, hintTitle, hintBody, onHint, linked, busy, onFlip, disabled, disabledHint } = props;
  return (
    <div
      data-tweak={tweakId}
      className={`switch-row ${on ? "on" : "off"}${disabled ? " is-disabled" : ""}${linked ? " is-linked" : ""}`}
    >
      <span className="check-func">{func}</span>
      <div className="switch-body">
        <span className="switch-name">
          {name}
          <button
            type="button"
            className="switch-hint"
            aria-label={hintTitle}
            onClick={() => onHint(hintTitle, hintBody)}
          >
            <Info size={13} />
          </button>
        </span>
        <span className="switch-desc">{desc}</span>
        {disabled && disabledHint ? (
          <span className="switch-reason">{disabledHint}</span>
        ) : null}
      </div>
      <span className={`check-badge ${on ? "ok" : "warn"}`}>
        {on ? t.checkOkBadge : t.checkWarnBadge}
      </span>
      <button
        role="switch"
        aria-checked={on}
        aria-label={name}
        aria-disabled={disabled}
        className="switch"
        disabled={busy || disabled}
        onClick={() => void onFlip(!on)}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}

export function ToolsView(props: {
  active: boolean;
  /** health-card deep-link target row id (DVR today): one-shot, cleared
      via onToolOpened once the landing finishes — same contract as the
      Reports openId */
  toolOpenId: string | null;
  onToolOpened: () => void;
}) {
  const { active, toolOpenId, onToolOpened } = props;
  const { t } = useLang();
  /** which card's details are open (the landing cards need no data) */
  const [openCard, setOpenCard] = useState<"gaming" | "storage" | null>(null);
  /** optimistic switch positions: flip instantly on click; restored to the
      verified live truth after the write settles (and on every fresh read) */
  const [dvrOn, setDvrOn] = useState<boolean | null>(null);
  const [ssOn, setSsOn] = useState<boolean | null>(null);
  const [gameModeOn, setGameModeOn] = useState<boolean | null>(null);
  /** tri-state rows (on/off/disabled-with-reason/hidden) for preconditions
      the user can fix — "hidden" never reaches the render below */
  const [fsoState, setFsoState] = useState<RowState>("hidden");
  const [gpuState, setGpuState] = useState<RowState>("hidden");
  const [wgcOn, setWgcOn] = useState<boolean | null>(null);
  const [mouseOn, setMouseOn] = useState<boolean | null>(null);
  /** failed-write notice body (null = no notice) */
  const [notice, setNotice] = useState<string | null>(null);
  /** background-note dialog behind a row's (?) button (null = closed).
      The same unified Dialog as the failed-write notice: one modal surface,
      so the two can never stack (a flip needs a click, impossible behind
      an open modal). */
  const [hint, setHint] = useState<{ title: string; body: string } | null>(null);
  /** failed-READ body for the details page's error state (a separate
      surface: a read failure is a state, not a dialog) */
  const [noticeBody, setNoticeBody] = useState<string | null>(null);
  const [tweakBusy, setTweakBusy] = useState(false);
  /** the busy gate as a REF (the Checks/Processes pattern): two clicks in
      the same tick both read a stale `false` from state — the ref is
      synchronous, so the second click is refused immediately */
  const tweakBusyRef = useRef(false);
  /** true once a fresh read has landed (landing card renders instantly,
      details wait for real data instead of showing a dead shell) */
  const [loaded, setLoaded] = useState(false);
  /** deep-link highlight row id (the health DVR card landed here): ringed
      for a moment, cleared with the link itself */
  const [linkedId, setLinkedId] = useState<string | null>(null);
  /** the details list element: the link landing scrolls within it */
  const listRef = useRef<HTMLDivElement>(null);
  /** a fresh read FAILED and never landed: the details page must say so
      honestly instead of spinning "Loading..." forever (the window-focus
      retry stays the rescue) */
  const [loadFailed, setLoadFailed] = useState(false);

  /** fresh switch positions, live from the registry: Windows is the
      single source of truth, so every entry point (open the details page
      / window focus) re-reads live — manual changes outside the app must
      be picked up here. The read is tweak_states (a handful of registry
      values, microseconds), never the full system_checks batch whose rows
      this page does not display. */
  const reload = async () => {
    try {
      const s = await api.tweakStates();
      setDvrOn(!s.game_dvr_enabled);
      setSsOn(s.storage_sense);
      setGameModeOn(s.game_mode);
      setFsoState(s.fso_disabled);
      setWgcOn(s.windowed_game_opt);
      setGpuState(s.gpu_high_perf);
      setMouseOn(s.mouse_accel_off);
      setLoaded(true);
      setLoadFailed(false);
      setNoticeBody(null);
    } catch (e) {
      // an honest failure state: the landing card keeps showing, and the
      // details page (if open) surfaces the error instead of an eternal
      // "Loading..." — the raw message rides along as a technical line
      setLoadFailed(true);
      const raw = typeof e === "string" ? e : String(e);
      setNotice(null); // a notice dialog would stack over the details error
      setNoticeBody(t.dialog.unknownErrorBody(raw));
    }
  };

  useEffect(() => {
    if (!active || !openCard) return;
    void reload();
    // the read contract is about a DETAILS page being visible, not the
    // tab alone: the landing cards need no data, so no read fires for them
    // (and none fires on window focus while they show, either)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, openCard]);

  // returning from Windows Settings (after flipping something by hand)
  // re-reads live: the switch must mirror what Windows says now
  useEffect(() => {
    if (!active || !openCard) return;
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // same as above: reload's identity is not part of the subscription
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, openCard]);

  // deep-link: the health DVR card jumps here. The rows live on the
  // GAMING details page, so the link opens it first (the open effect above fires
  // the live read); the landing effect below scrolls once data arrives.
  useEffect(() => {
    if (toolOpenId && openCard !== "gaming") setOpenCard("gaming");
    // one-shot per link arrival, like the Reports openId effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolOpenId]);

  useEffect(() => {
    if (!toolOpenId || openCard !== "gaming" || !loaded) return;
    const target = toolOpenId;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-tweak="${target}"]`);
    if (!row) {
      // the linked row is not rendered on this machine (hidden, not
      // disabled): clear the link instead of re-firing on every visit
      onToolOpened();
      return;
    }
    setLinkedId(target);
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.querySelector<HTMLButtonElement>("button.switch")?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => {
      setLinkedId(null);
      onToolOpened();
    }, 2200);
    return () => window.clearTimeout(timer);
    // one-shot per link arrival, like the Reports openId effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolOpenId, openCard, loaded]);

  // a dialog mounting under a parked cursor never fires mouseleave — tell
  // every tooltip to hide the moment ours opens (same signal as the shell)
  useEffect(() => {
    if (notice || hint) {
      window.dispatchEvent(new Event(MODAL_OPEN_EVENT));
    }
  }, [notice, hint]);

  // one modal surface, app-wide: if the App-level dialog (gameloop
  // closed, an advice) opens while our failed-write notice is up, ours
  // yields instead of stacking two overlays where one Escape closes both.
  // The notice is informational; the App dialog is not re-askable.
  useEffect(() => {
    if (!notice && !hint) return;
    const onAppDialog = () => {
      setNotice(null);
      setHint(null);
    };
    window.addEventListener(APP_DIALOG_OPEN_EVENT, onAppDialog);
    return () => window.removeEventListener(APP_DIALOG_OPEN_EVENT, onAppDialog);
  }, [notice, hint]);

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
    gamemode: {
      goal: (on: boolean): 0 | 1 => (on ? 1 : 0), // ON = mode on
      set: setGameModeOn,
      get: () => gameModeOn,
    },
    fso: {
      goal: (on: boolean): 0 | 1 => (on ? 1 : 0), // ON = optimizations disabled
      set: (v: boolean) => setFsoState(v ? "on" : "off"),
      // only on/off are flippable — disabled/hidden never reach the
      // button (disabled renders greyed, hidden renders nothing)
      get: () => (fsoState === "on" ? true : fsoState === "off" ? false : null),
    },
    gpupref: {
      goal: (on: boolean): 0 | 1 => (on ? 1 : 0), // ON = high-performance preferred
      set: (v: boolean) => setGpuState(v ? "on" : "off"),
      get: () => (gpuState === "on" ? true : gpuState === "off" ? false : null),
    },
    windowedopt: {
      goal: (on: boolean): 0 | 1 => (on ? 1 : 0), // ON = optimizations on
      set: setWgcOn,
      get: () => wgcOn,
    },
    mouse: {
      goal: (on: boolean): 0 | 1 => (on ? 1 : 0), // ON = precision off
      set: setMouseOn,
      get: () => mouseOn,
    },
  } as const;
  type TweakId = keyof typeof TWEAKS;

  /** background note behind a row's (?) button: title + body into the one
      shared Dialog below */
  const showHint = (title: string, body: string) => setHint({ title, body });

  /** generic flip: optimistic move, explicit write both directions,
      verified live truth settles the final position. A verified result IS
      the fresh truth (the engine re-read the registry to confirm it), so
      no full reload after a click — the heavy batch refresh stays at its
      real entry points: opening the view and window focus. */
  const flipTweak = async (id: TweakId, on: boolean) => {
    const tweak = TWEAKS[id];
    // the REF gate: synchronous, so a double-click in one tick cannot slip
    // two writes through (state read was async and both saw `false`)
    if (tweakBusyRef.current) return;
    const before = tweak.get();
    if (before === null) return; // feature unavailable or not read yet
    tweakBusyRef.current = true;
    tweak.set(on); // optimistic: the switch answers instantly
    setTweakBusy(true);
    try {
      const res = await api.setTweak(id, tweak.goal(on));
      if (!res.verified) {
        tweak.set(before); // roll back to the truth we knew
        setNotice(t.tweakFailed);
        return;
      }
      // verified: the switch stays where the optimistic move put it —
      // the engine confirmed the registry holds exactly this state now
    } catch (e) {
      tweak.set(before);
      const raw = typeof e === "string" ? e : String(e);
      // a refused elevation is a choice, not a failure: roll back silently
      // (same exact-"cancelled" contract as the update flow — a message
      // merely containing the word still counts as a real error)
      if (raw === "cancelled") return;
      setNotice(t.dialog.unknownErrorBody(raw));
    } finally {
      tweakBusyRef.current = false;
      setTweakBusy(false);
    }
  };

  if (openCard) {
    if (!loaded) {
      // details wait for a real read: a dead shell must never show, and a
      // FAILED read surfaces as an honest error instead of a "Loading..."
      // that spins forever (the window-focus retry is the rescue)
      return (
        <div className="tools">
          <button className="tools-back" onClick={() => setOpenCard(null)}>
            <ChevronLeft size={16} />
            {t.toolsBack}
          </button>
          <EmptyState
            icon={<SlidersHorizontal size={18} />}
            title={loadFailed ? t.dialog.somethingWrong : t.loading}
            hint={loadFailed && noticeBody ? noticeBody : ""}
          />
        </div>
      );
    }
    const gaming = openCard === "gaming";
    return (
      <div className="tools">
        <button className="tools-back" onClick={() => setOpenCard(null)}>
          <ChevronLeft size={16} />
          {t.toolsBack}
        </button>
        {gaming ? (
        <div className="check-list" ref={listRef}>
          {/* hidden until read; a feature the Windows build lacks stays
              hidden — a dead switch must never be shown. No area dividers:
              every row here targets gaming, subdivision would be noise. */}
          {dvrOn !== null ? (
            <SwitchRow
              tweakId="dvr"
              linked={linkedId === "dvr"}
              on={dvrOn}
              func={<Video size={15} />}
              name={t.tweakDvrTitle}
              desc={t.tweakDvrDesc}
              hintTitle={t.tweakDvrTitle}
              hintBody={t.tweakDvrHint}
              onHint={showHint}
              busy={tweakBusy}
              onFlip={(next) => void flipTweak("dvr", next)}
            />
          ) : null}
          {gameModeOn !== null ? (
            <SwitchRow
              tweakId="gamemode"
              linked={linkedId === "gamemode"}
              on={gameModeOn}
              func={<Gamepad2 size={15} />}
              name={t.tweakGameModeTitle}
              desc={t.tweakGameModeDesc}
              hintTitle={t.tweakGameModeTitle}
              hintBody={t.tweakGameModeHint}
              onHint={showHint}
              busy={tweakBusy}
              onFlip={(next) => void flipTweak("gamemode", next)}
            />
          ) : null}
          {fsoState !== "hidden" ? (
            <SwitchRow
              tweakId="fso"
              linked={linkedId === "fso"}
              on={fsoState === "on"}
              func={<Expand size={15} />}
              name={t.tweakFsoTitle}
              desc={t.tweakFsoDesc}
              hintTitle={t.tweakFsoTitle}
              hintBody={t.tweakFsoHint}
              onHint={showHint}
              busy={tweakBusy}
              disabled={fsoState === "disabled_gameloop_not_found"}
              disabledHint={t.tweakNeedsGameloop}
              onFlip={(next) => void flipTweak("fso", next)}
            />
          ) : null}
          {wgcOn !== null ? (
            <SwitchRow
              tweakId="windowedopt"
              linked={linkedId === "windowedopt"}
              on={wgcOn}
              func={<AppWindow size={15} />}
              name={t.tweakWindowedTitle}
              desc={t.tweakWindowedDesc}
              hintTitle={t.tweakWindowedTitle}
              hintBody={t.tweakWindowedHint}
              onHint={showHint}
              busy={tweakBusy}
              onFlip={(next) => void flipTweak("windowedopt", next)}
            />
          ) : null}
          {gpuState !== "hidden" ? (
            <SwitchRow
              tweakId="gpupref"
              linked={linkedId === "gpupref"}
              on={gpuState === "on"}
              func={<Monitor size={15} />}
              name={t.tweakGpuTitle}
              desc={t.tweakGpuDesc}
              hintTitle={t.tweakGpuTitle}
              hintBody={t.tweakGpuHint}
              onHint={showHint}
              busy={tweakBusy}
              disabled={gpuState === "disabled_gameloop_not_found"}
              disabledHint={t.tweakNeedsGameloop}
              onFlip={(next) => void flipTweak("gpupref", next)}
            />
          ) : null}
          {mouseOn !== null ? (
            <SwitchRow
              tweakId="mouse"
              linked={linkedId === "mouse"}
              on={mouseOn}
              func={<Mouse size={15} />}
              name={t.tweakMouseTitle}
              desc={t.tweakMouseDesc}
              hintTitle={t.tweakMouseTitle}
              hintBody={t.tweakMouseHint}
              onHint={showHint}
              busy={tweakBusy}
              onFlip={(next) => void flipTweak("mouse", next)}
            />
          ) : null}
        </div>
        ) : (
        <div className="check-list">
          {/* hidden when the Windows build has no Storage Sense policy
              key (storage_sense === null): never a dead switch */}
          {ssOn !== null ? (
            <SwitchRow
              tweakId="storagesense"
              linked={linkedId === "storagesense"}
              on={ssOn}
              func={<Recycle size={15} />}
              name={t.tweakSsTitle}
              desc={t.tweakSsDesc}
              hintTitle={t.tweakSsTitle}
              hintBody={t.tweakSsHint}
              onHint={showHint}
              busy={tweakBusy}
              onFlip={(next) => void flipTweak("storagesense", next)}
            />
          ) : null}
          {/* PLACEHOLDER, remove with the key when the storage phase
              starts: one row cannot carry a card alone without saying
              what lives here next */}
          <p className="tool-note">{t.toolStorageComing}</p>
        </div>
        )}
        {/* background note behind a row's (?) button — the same unified
            Dialog as the failed-write notice below (one modal surface) */}
        {hint ? (
          <Dialog
            title={hint.title}
            body={hint.body}
            kind="notice"
            okLabel={t.dialog.ok}
            onClose={() => setHint(null)}
          />
        ) : null}
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
      {/* no intro paragraph: it duplicated the card description below
          almost verbatim — the card carries the meaning alone */}
      <div className="tools-grid">
        <button className="tool-card" onClick={() => setOpenCard("gaming")}>
          <img
            className="tool-spot"
            src={document.documentElement.dataset.theme === "light" ? spotTweaksLight : spotTweaksDark}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <span className="tool-title-row">
            <span className="tool-title">{t.toolGamingTweaks}</span>
            <span className="sb-beta">{t.toolsBeta}</span>
          </span>
          <span className="tool-desc">{t.toolGamingTweaksDesc}</span>
        </button>
        <button className="tool-card" onClick={() => setOpenCard("storage")}>
          <img
            className="tool-spot"
            src={document.documentElement.dataset.theme === "light" ? spotStorageLight : spotStorageDark}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <span className="tool-title-row">
            <span className="tool-title">{t.toolStorage}</span>
            <span className="sb-beta">{t.toolsBeta}</span>
          </span>
          <span className="tool-desc">{t.toolStorageDesc}</span>
        </button>
      </div>
    </div>
  );
}
