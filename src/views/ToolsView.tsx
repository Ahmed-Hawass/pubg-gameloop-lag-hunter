// ToolsView.tsx — one card per area (Gaming tweaks, Storage), each opening
// its own details list. A switch MIRRORS THE LIVE RESULT of its named action
// (ON = the action holds right now, whoever made it hold), so manual changes
// outside the app appear on the next fresh read: opening a details page and
// regaining window focus both re-read live. The read is the lightweight
// tweak_states command (a handful of registry values, microseconds) — never the
// full system_checks batch, whose rows this page does not display.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronDown, Database, Expand, Gamepad2, Info, Monitor, Mouse, Recycle, SlidersHorizontal, Video, AppWindow, Zap } from "lucide-react";
import { Button, Dialog, EmptyState, MODAL_OPEN_EVENT, APP_DIALOG_OPEN_EVENT } from "../components/components";
import { api, type PagefileSettings, type RowState } from "../bridge";
import { errorDialog } from "../errors";
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
  /** health-card deep-link target (a gaming row id, or "pagefile" for
      the Storage editor): one-shot, cleared via onToolOpened once the
      landing finishes — same contract as the Reports openId */
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
  /** power plan row: On = High performance active; Off = present or
      restorable; Hidden = Ultimate active or S0-only firmware */
  const [powerState, setPowerState] = useState<RowState>("hidden");
  const [wgcOn, setWgcOn] = useState<boolean | null>(null);
  const [mouseOn, setMouseOn] = useState<boolean | null>(null);
  /** Virtual Memory-style editor: the backend's single read (global
      automatic flag + one live state per fixed drive). Null = not read
      yet; a failed read surfaces inline below, never a guessed editor. */
  const [pfSettings, setPfSettings] = useState<PagefileSettings | null>(null);
  /** mapped page file read-failure body (null = no failure) */
  const [pfError, setPfError] = useState<string | null>(null);
  /** working copies the user edits (dirty = a fresh read must not
      clobber typing, selection, or the checkbox) */
  const [pfAutomatic, setPfAutomatic] = useState(true);
  const [pfDrive, setPfDrive] = useState("");
  const pfDriveRef = useRef("");
  const [pfMode, setPfMode] = useState<"system" | "custom" | "off">("system");
  const [minInput, setMinInput] = useState("");
  const [maxInput, setMaxInput] = useState("");
  /** true once the user typed (a fresh read must not clobber typing) */
  const dirtyRef = useRef(false);
  /** pre-write confirm payload (null = no confirm): "off" names a
      destructive destination, "small" warns below the stutter floor */
  const [pfConfirm, setPfConfirm] = useState<{ warning: "off" | "small" } | null>(null);
  /** the editor collapses under its summary row (the section never
      opens itself: only a tap, or a health-card landing, expands it —
      the pending badge on the summary carries the waiting reboot) */
  const [pfOpen, setPfOpen] = useState(false);
  /** reboot offer after a verified page file write (once per write,
      never on load — Later dismisses for good until the next write) */
  const [rebootModal, setRebootModal] = useState(false);
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
  /** read generation: bumped on every flip start. A reload that STARTED
      before the current generation applies nothing on completion — it
      read the pre-flip truth and would paint it over the verified
      result (the ON-bounce seen on the slow power row: UAC + powercfg
      leave seconds for a stale read to land late). */
  const genRef = useRef(0);
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

  /** backend machine key to dialog body (known keys get their copy; a
      novel message rides along as the technical line, never raw English
      into an Arabic dialog) */
  const pfErrorBody = (raw: string) =>
    errorDialog(raw, t.errors, {
      somethingWrong: t.dialog.somethingWrong,
      scanNeedsGame: t.dialog.scanNeedsGame,
      scanNeedsGameBody: t.dialog.scanNeedsGameBody,
      unknownErrorBody: t.dialog.unknownErrorBody,
    }).body;

  /** fresh switch positions, live from the registry: Windows is the
      single source of truth, so every entry point (open the details page
      / window focus) re-reads live — manual changes outside the app must
      be picked up here. The read is tweak_states (a handful of registry
      values, microseconds), never the full system_checks batch whose rows
      this page does not display. */
  const reload = async () => {
    // generation at START: if a flip begins while this read is in flight,
    // the completion below applies nothing (stale truth must never paint
    // over an optimistic switch, let alone a verified one)
    const gen = genRef.current;
    try {
      const s = await api.tweakStates();
      if (gen !== genRef.current) return;
      setDvrOn(!s.game_dvr_enabled);
      setSsOn(s.storage_sense);
      setGameModeOn(s.game_mode);
      setFsoState(s.fso_disabled);
      setWgcOn(s.windowed_game_opt);
      setGpuState(s.gpu_high_perf);
      setPowerState(s.power_high_perf);
      setMouseOn(s.mouse_accel_off);
      try {
        const pf = await api.pagefileSettings();
        if (gen !== genRef.current) return;
        setPfSettings(pf);
        setPfError(null);
        if (!dirtyRef.current) {
          // sync the working copies from live (never while the user is
          // editing); the selection survives when the drive is still
          // there, the mode falls back to custom on an unreadable drive
          // (forces an explicit choice, validation guides from there)
          setPfAutomatic(pf.automatic);
          const drive = pf.drives.some((d) => d.drive === pfDriveRef.current)
            ? pfDriveRef.current
            : (pf.drives[0]?.drive ?? "");
          pfDriveRef.current = drive;
          setPfDrive(drive);
          const live = pf.drives.find((d) => d.drive === drive);
          setPfMode(live && live.mode !== "unknown" ? live.mode : "custom");
          setMinInput(live?.min_mb?.toString() ?? "");
          setMaxInput(live?.max_mb?.toString() ?? "");
        }
      } catch (e) {
        if (gen !== genRef.current) return;
        // the editor reads nothing guessed: an inline honest error, the
        // rest of the page keeps working (the window-focus retry rescues)
        const raw = typeof e === "string" ? e : String(e);
        setPfSettings(null);
        setPfError(pfErrorBody(raw));
      }
      setLoaded(true);
      setLoadFailed(false);
      setNoticeBody(null);
    } catch (e) {
      // same staleness rule for the error surface: a failed pre-flip read
      // must not raise an error page over a flip that already settled
      if (gen !== genRef.current) return;
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
    // no fresh reads while a flip is in flight (the busy gate is a ref,
    // so this is exact even for a focus storm): the verified result is
    // the truth until it lands, and a mid-flip read could only paint
    // the pre-flip state over it
    if (tweakBusyRef.current) return;
    void reload();
    // the read contract is about a DETAILS page being visible, not the
    // tab alone: the landing cards need no data, so no read fires for them
    // (and none fires on window focus while they show, either)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, openCard]);

  // returning from Windows Settings (after flipping something by hand)
  // re-reads live: the switch must mirror what Windows says now.
  // Skipped mid-flip (same guard as the open effect): the UAC round-trip
  // always passes through the secure desktop, so a focus storm is
  // guaranteed exactly when a stale read would hurt most.
  useEffect(() => {
    if (!active || !openCard) return;
    const onFocus = () => {
      if (tweakBusyRef.current) return;
      void reload();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // same as above: reload's identity is not part of the subscription
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, openCard]);

  // deep-link: a health card jumps here (DVR to the GAMING page, the
  // page file to the STORAGE section). The link opens the right page
  // first (the open effect above fires the live read); the landing
  // effect below scrolls once data arrives.
  useEffect(() => {
    if (!toolOpenId) return;
    const card = toolOpenId === "pagefile" ? "storage" : "gaming";
    if (openCard !== card) setOpenCard(card);
    // one-shot per link arrival, like the Reports openId effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolOpenId]);

  useEffect(() => {
    if (!toolOpenId || !loaded) return;
    const wantCard = toolOpenId === "pagefile" ? "storage" : "gaming";
    if (openCard !== wantCard) return;
    // the page file landing opens its accordion (the summary alone
    // would hide the editor the card promised)
    if (toolOpenId === "pagefile") setPfOpen(true);
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
    row
      .querySelector<HTMLButtonElement>("button.switch, button.pf-summary-main")
      ?.focus({ preventScroll: true });
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
    powerplan: {
      goal: (on: boolean): 0 | 1 => (on ? 1 : 0), // ON = High performance active
      set: (v: boolean) => setPowerState(v ? "on" : "off"),
      // only on/off are flippable — hidden never reaches the render below.
      // The flip runs elevated (one UAC per press); a refused prompt rolls
      // back silently, a post-consent failure shows the notice.
      get: () => (powerState === "on" ? true : powerState === "off" ? false : null),
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
    genRef.current += 1; // any read older than this is stale on arrival
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

  /** digits-only field writer (mirrors the dialog: garbage never enters,
      Arabic-Indic digits normalized, 10-char DWORD cap) */
  const writeDigits = (
    raw: string,
    set: (v: string) => void,
  ) => {
    const latin = raw.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    set(latin.replace(/\D/g, "").slice(0, 10));
    dirtyRef.current = true;
  };

  /** pick a drive in the editor: the mode + sizes prefill from that
      drive's live state (unreadable forces custom-with-empty, an
      explicit choice validation guides from there) */
  const selectPfDrive = (drive: string) => {
    if (!pfSettings) return;
    dirtyRef.current = true;
    pfDriveRef.current = drive;
    setPfDrive(drive);
    const live = pfSettings.drives.find((d) => d.drive === drive);
    setPfMode(live && live.mode !== "unknown" ? live.mode : "custom");
    setMinInput(live?.min_mb?.toString() ?? "");
    setMaxInput(live?.max_mb?.toString() ?? "");
  };

  /** one drive's status line: letter, free space, live mode (read, never
      derived from the working copies) */
  const pfDriveLine = (drive: string, freeMb: number | null, mode: string, min: number | null, max: number | null) => {
    const free = freeMb == null
      ? t.tweakPfDriveNoSpace(drive)
      : t.tweakPfDriveFree(drive, Math.round(freeMb / 1024));
    const state =
      mode === "custom" && min != null && max != null
        ? t.tweakPfDriveCustom(min, max)
        : mode === "system"
          ? t.tweakPfModeSystem
          : mode === "off"
            ? t.tweakPfModeOff
            : t.tweakPfModeUnknown;
    return `${free} · ${state}`;
  };

  /** Apply dies while nothing differs from live (no dead round-trip,
      no pointless UAC): automatic flag first, then the selected drive's
      mode and sizes */
  const pfLiveDrive = pfSettings?.drives.find((d) => d.drive === pfDrive);
  const pfUnchanged = (() => {
    if (!pfSettings || !pfLiveDrive) return true;
    if (pfAutomatic !== pfSettings.automatic) return false;
    if (pfAutomatic) return true;
    const liveMode = pfLiveDrive.mode === "unknown" ? "custom" : pfLiveDrive.mode;
    if (pfMode !== liveMode) return false;
    if (pfMode !== "custom") return true;
    return (
      minInput === (pfLiveDrive.min_mb?.toString() ?? "") &&
      maxInput === (pfLiveDrive.max_mb?.toString() ?? "")
    );
  })();

  /** the editor write: one elevated request, verified live truth settles
      it. A verified result IS the fresh truth, so the reload below only
      refreshes the working copies (dirty cleared first). */
  const runPfApply = async () => {
    if (tweakBusyRef.current || !pfSettings) return;
    genRef.current += 1;
    tweakBusyRef.current = true;
    setTweakBusy(true);
    try {
      const res = await api.applyPagefileSettings(pfAutomatic, pfDrive, pfMode, minInput, maxInput);
      if (!res.verified) {
        setNotice(t.tweakFailed);
        return;
      }
      dirtyRef.current = false;
      setPfConfirm(null);
      setRebootModal(true);
      void reload();
    } catch (e) {
      const raw = typeof e === "string" ? e : String(e);
      // a refused elevation is a choice, not a failure: silent, like flips
      if (raw === "cancelled") return;
      setNotice(pfErrorBody(raw));
    } finally {
      tweakBusyRef.current = false;
      setTweakBusy(false);
    }
  };

  /** Apply entry: the backend validates first (keys, never sentences)
      for the confirm step ("off" and "small" pause on a confirm, clean
      requests go straight to the write). */
  const applyPf = async () => {
    if (tweakBusyRef.current || !pfSettings || pfUnchanged) return;
    try {
      const warning = await api.validatePagefileSettings(
        pfAutomatic,
        pfDrive,
        pfMode,
        minInput,
        maxInput,
      );
      if (warning === "off" || warning === "small") {
        setPfConfirm({ warning });
        return;
      }
    } catch (e) {
      const raw = typeof e === "string" ? e : String(e);
      if (raw === "cancelled") return;
      setNotice(pfErrorBody(raw));
      return;
    }
    void runPfApply();
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
          {powerState !== "hidden" ? (
            <SwitchRow
              tweakId="powerplan"
              linked={linkedId === "powerplan"}
              on={powerState === "on"}
              func={<Zap size={15} />}
              name={t.tweakPowerTitle}
              desc={t.tweakPowerDesc}
              hintTitle={t.tweakPowerTitle}
              hintBody={t.tweakPowerHint}
              onHint={showHint}
              busy={tweakBusy}
              onFlip={(next) => void flipTweak("powerplan", next)}
            />
          ) : null}
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
        <div className="check-list" ref={listRef}>
          {/* the section's face: one summary row (title + live global
              status), the editor lives one tap under it instead of owning
              the page open forever */}
          {pfSettings ? (
            <div
              data-tweak="pagefile"
              className={`pf-summary${pfSettings.automatic ? " on" : " off"}${linkedId === "pagefile" ? " is-linked" : ""}`}
            >
              <button
                type="button"
                className="pf-summary-main"
                aria-expanded={pfOpen}
                onClick={() => setPfOpen(!pfOpen)}
              >
                <span className="check-func">
                  <Database size={15} />
                </span>
                <span className="pf-summary-text">
                  <span className="switch-name">{t.tweakPfTitle}</span>
                  <span className="switch-desc">
                    {pfSettings.automatic ? t.tweakPfStatusAuto : t.tweakPfStatusManual}
                  </span>
                </span>
                {/* pending survives collapsing: the full note lives in
                    the expanded card, this badge keeps the collapsed row
                    honest */}
                {pfSettings.pending ? (
                  <span className="check-badge warn">{t.tweakPfPendingBadge}</span>
                ) : null}
                <ChevronDown
                  size={16}
                  className={`pf-chev${pfOpen ? " is-open" : ""}`}
                />
              </button>
              <button
                type="button"
                className="switch-hint"
                aria-label={t.tweakPfTitle}
                onClick={() => showHint(t.tweakPfTitle, t.tweakPfHint)}
              >
                <Info size={13} />
              </button>
            </div>
          ) : null}
          {/* read failure: the editor shows nothing guessed (an inline
              honest error; the window-focus retry is the rescue) */}
          {pfError ? (
            <EmptyState
              icon={<Database size={18} />}
              title={t.dialog.somethingWrong}
              hint={pfError}
            />
          ) : null}
          {/* per-drive live lines + the Virtual Memory-style editor, only
              while expanded: global automatic checkbox, one selectable row
              per fixed drive, the selected drive's mode, sizes only for
              custom (only the selected drive ever changes) */}
          {pfSettings && pfOpen ? (
            <div className="pf-status">
              {pfSettings.drives.map((d) => (
                <span key={d.drive} className="switch-desc">
                  {pfDriveLine(d.drive, d.free_mb, d.mode, d.min_mb, d.max_mb)}
                </span>
              ))}
            </div>
          ) : null}
          {pfSettings && pfOpen ? (
            <div className="pf-form">
              {/* the (?) lives on the summary row (always visible); no
                  second copy in here */}
              <label className="pf-auto">
                <input
                  type="checkbox"
                  checked={pfAutomatic}
                  disabled={tweakBusy}
                  onChange={(e) => {
                    dirtyRef.current = true;
                    setPfAutomatic(e.target.checked);
                  }}
                />
                <span>{t.tweakPfAutoLabel}</span>
              </label>
              <div className={pfAutomatic ? "pf-manual is-disabled" : "pf-manual"}>
                <span className="switch-desc">{t.tweakPfDrivesLabel}</span>
                <div className="pf-drives" role="radiogroup" aria-label={t.tweakPfDrivesLabel}>
                  {pfSettings.drives.map((d) => (
                    <button
                      key={d.drive}
                      type="button"
                      role="radio"
                      aria-checked={d.drive === pfDrive}
                      className={`pf-drive${d.drive === pfDrive ? " is-selected" : ""}`}
                      disabled={tweakBusy || pfAutomatic}
                      onClick={() => selectPfDrive(d.drive)}
                    >
                      <span className="pf-drive-id num">{d.drive}</span>
                      <span className="pf-drive-state">
                        {pfDriveLine(d.drive, d.free_mb, d.mode, d.min_mb, d.max_mb)}
                      </span>
                    </button>
                  ))}
                </div>
                {/* the mode in the app's own selection language (the same
                    segmented pills as language/theme): one tap, the active
                    segment fills */}
                <div className="lang-segment" role="radiogroup" aria-label={t.tweakPfTitle}>
                  {(
                    [
                      ["system", t.tweakPfModeSystem],
                      ["custom", t.tweakPfModeCustom],
                      ["off", t.tweakPfModeOff],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={pfMode === mode}
                      className={`lang-seg${pfMode === mode ? " is-active" : ""}`}
                      disabled={tweakBusy || pfAutomatic}
                      onClick={() => {
                        dirtyRef.current = true;
                        setPfMode(mode);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="pf-fields">
                  <label className="pf-field">
                    <span>{t.tweakPfMinLabel}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={10}
                      value={minInput}
                      disabled={tweakBusy || pfAutomatic || pfMode !== "custom"}
                      onChange={(e) => writeDigits(e.target.value, setMinInput)}
                    />
                  </label>
                  <label className="pf-field">
                    <span>{t.tweakPfMaxLabel}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={10}
                      value={maxInput}
                      disabled={tweakBusy || pfAutomatic || pfMode !== "custom"}
                      onChange={(e) => writeDigits(e.target.value, setMaxInput)}
                    />
                  </label>
                  <Button
                    label={t.tweakPfApply}
                    variant="ghost"
                    disabled={tweakBusy || pfUnchanged}
                    onClick={() => void applyPf()}
                  />
                </div>
              </div>
            </div>
          ) : null}
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
          {/* pending reboot note, inside the expanded card (self-clearing
              on reboot, no writes); the summary badge above covers the
              collapsed state */}
          {pfSettings && pfOpen && pfSettings.pending ? (
            <p className="tool-note">{t.tweakPfPending}</p>
          ) : null}
        </div>
        )}
        {/* pre-write confirm from the backend's validate step: "off"
            names its destructive destination like a delete (danger
            styling), "small" warns below the diagnosed stutter floor but
            allows (the engine floor constant is the same number) */}
        {pfConfirm ? (
          <Dialog
            title={
              pfConfirm.warning === "off"
                ? t.tweakPfWarnOffTitle(pfDrive)
                : t.tweakPfWarnSmallTitle
            }
            body={
              pfConfirm.warning === "off"
                ? t.tweakPfWarnOffBody(pfDrive)
                : t.tweakPfWarnSmallBody(pfDrive, parseInt(maxInput, 10) || 0)
            }
            kind="confirm"
            danger={pfConfirm.warning === "off"}
            confirmLabel={t.tweakPfApply}
            cancelLabel={t.dialog.cancel}
            onConfirm={() => {
              setPfConfirm(null);
              void runPfApply();
            }}
            onClose={() => setPfConfirm(null)}
          />
        ) : null}
        {/* reboot offer, once per verified write (Later dismisses until
            the next write — never nagged on load) */}
        {rebootModal ? (
          <Dialog
            title={t.rebootTitle}
            body={t.rebootBody}
            kind="confirm"
            confirmLabel={t.rebootNow}
            cancelLabel={t.rebootLater}
            onConfirm={() => {
              setRebootModal(false);
              void api
                .scheduleReboot()
                .catch(() => setNotice(t.tweakFailed));
            }}
            onClose={() => setRebootModal(false)}
          />
        ) : null}
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
          </span>
          <span className="tool-desc">{t.toolStorageDesc}</span>
        </button>
      </div>
    </div>
  );
}
