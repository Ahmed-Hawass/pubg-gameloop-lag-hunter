// App.tsx — shell: custom title bar + collapsible sidebar + all views.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ChevronsLeft,
  ChevronsRight,
  Cpu,
  Crosshair,
  FolderOpen,
  Info,
  Settings,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { TitleBar } from "./components/TitleBar";
import { Dialog, MODAL_OPEN_EVENT, APP_DIALOG_OPEN_EVENT, Tip } from "./components/components";
import { MonitorView } from "./views/MonitorView";
import { ReportsView } from "./views/ReportsView";
import { SystemView } from "./views/SystemView";
import { ProcessesView } from "./views/ProcessesView";
import { ChecksView } from "./views/ChecksView";
import { ToolsView } from "./views/ToolsView";
import { AboutView } from "./views/AboutView";
import { SettingsView } from "./views/SettingsView";
import { WelcomeView } from "./views/WelcomeView";
import { api, closeWindow, onEngineState, type StatusPayload, type UpdateInfo } from "./bridge";
import { useLang } from "./i18n";
import { errorDialog } from "./errors";
import { shouldShowUpdateModal } from "./updateFlow";
import { resolveTheme, type ThemeSetting } from "./theme";
import { useUiZoom } from "./useUiZoom";
import { UpdateModal } from "./components/UpdateModal";

type View = "monitor" | "system" | "processes" | "checks" | "tools" | "reports" | "settings" | "about";

export default function App() {
  const { t } = useLang();
  const [status, setStatus] = useState<StatusPayload>({ status: "idle", ui: null });
  const [busy, setBusy] = useState(false);
  const [durationSecs, setDurationSecs] = useState<number>(300);
  const [dialogKey, setDialogKey] = useState<string | null>(null);
  const [dialogTitle, setDialogTitle] = useState<string | null>(null);
  const [dialogBody, setDialogBody] = useState<string | null>(null);
  const [view, setView] = useState<View>("monitor");
  const [reportOpenId, setReportOpenId] = useState<string | null>(null);
  /** Tools deep-link target row id (the health DVR card jumps to its row):
      one-shot, cleared by ToolsView once the landing finishes — the same
      contract as reportOpenId above */
  const [toolOpenId, setToolOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<boolean | null>(null); // null = loading saved pref
  /** first-run welcome: null = still loading the setting */
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  /** pre-scan advice ("close background apps"): shows ONCE EVER, the first
      time the app confirms the game is running; null = still loading */
  const [gameAdviceDone, setGameAdviceDone] = useState<boolean | null>(null);
  /** the pre-scan advice dialog is up (defers the update modal like the
      first-run advice does — one modal surface at a time) */
  const [gameAdviceUp, setGameAdviceUp] = useState(false);
  /** stay-in-game advice: shows ONCE EVER, the first time a RUNNING session
      measures the game window in the background; null = still loading */
  const [backgroundAdviceDone, setBackgroundAdviceDone] = useState<boolean | null>(null);
  /** the stay-in-game advice dialog is up (same one-modal deferral rule) */
  const [backgroundAdviceUp, setBackgroundAdviceUp] = useState(false);
  /** the first-run advice dialog: shows ONCE, only right after the user
      finishes the welcome flow (loaded-true users never see it) */
  const [firstRunAdviceShown, setFirstRunAdviceShown] = useState(false);
  /** the GameLoop-closed notice: once per session, never on manual/auto stops */
  const [closedNoticeShown, setClosedNoticeShown] = useState(false);
  /** whether onboarding was ALREADY done when the app loaded (distinguishes
      "just finished the welcome" from "finished it last year") */
  const wasOnboardedRef = useRef(false);
  /** the session whose summary the user dismissed — App-level so tab
      switches (which unmount MonitorView) can never resurrect it */
  const [dismissedSession, setDismissedSession] = useState<string | null>(null);
  /** sessions deleted from Reports (single or bulk) — the Monitor must
      never show a finished state for one of them */
  const [deletedSessions, setDeletedSessions] = useState<string[]>([]);
  const markDeleted = (ids: string[]) =>
    setDeletedSessions((prev) => [...prev, ...ids.filter((id) => !prev.includes(id))]);
  /** a newer version is available on GitHub (checked at startup, quietly;
      replaced by the About tab's manual check when that finds one first) */
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  /** the running version, ASKED ONCE from the engine (tauri.conf.json's
      single source of truth) and handed to both consumers — the old
      shape paid the IPC twice (TitleBar + AboutView each asked) */
  const [appVersion, setAppVersion] = useState<string>("");
  /** the update modal: shown at startup (once per version) or via manual check */
  const [updateModal, setUpdateModal] = useState(false);
  /** exit confirm (null = no request): which in-flight work the X press
      found (scan, download, cleaning). Empty = closeWindow directly. */
  const [exitConfirm, setExitConfirm] = useState<{
    scan: boolean;
    download: boolean;
    cleaning: boolean;
  } | null>(null);
  /** live mirrors for the exit gate (refs: the request reads them without
      re-subscribing; running/stopping both count as an active scan) */
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const downloadActiveRef = useRef(false);
  const cleaningActiveRef = useRef(false);
  const onDownloadActivity = useCallback((active: boolean) => {
    downloadActiveRef.current = active;
  }, []);
  const onCleaningActivity = useCallback((active: boolean) => {
    cleaningActiveRef.current = active;
  }, []);
  /** the X button path: quiet work closes straight away; a running scan,
      an active download, or a running cleanup names itself in one confirm
      instead. Cancelling is non-destructive (nothing was ever requested
      at OS level); confirming rides the normal close path, so the
      backend safety net (cancel download, stop + save the session) runs. */
  const requestExit = useCallback(() => {
    const blockers = {
      scan: statusRef.current.status === "running" || statusRef.current.status === "stopping",
      download: downloadActiveRef.current,
      cleaning: cleaningActiveRef.current,
    };
    if (!blockers.scan && !blockers.download && !blockers.cleaning) {
      void closeWindow();
      return;
    }
    setExitConfirm(blockers);
    window.dispatchEvent(new Event(APP_DIALOG_OPEN_EVENT));
  }, []);
  /** first-run advice is up RIGHT NOW — derived from the live dialog state,
      never a sticky flag: the update modal and the one-shot advices defer
      while this dialog is on screen, and stop deferring the moment it is
      dismissed (a sticky boolean once deferred them for the whole launch) */
  const firstRunAdviceUp = dialogKey === "first_run_advice";
  /** theme setting ("auto" follows the OS — also the default for a fresh
      install); the resolved value drives
      document.documentElement.dataset.theme — single source of truth,
      SettingsView only sends changes through onThemeChange below */
  const [themeSetting, setThemeSetting] = useState<ThemeSetting>("auto");
  /** interface zoom percent (fixed ladder in useUiZoom): owned here like
      the theme, so pills and shortcuts share one state; SettingsView
      only sends changes through onZoomChange below */
  const { zoom, setZoomPct, zoomIn, zoomOut, resetZoom } = useUiZoom();
  /** reveal Tools rows the machine cannot run (owned here like the
      theme: Settings pills, the gaming-page link, and the page share
      one state, persisted per machine) */
  const [showUnsupported, setShowUnsupported] = useState(false);

  // zoom shortcuts (browser convention, VS Code included): Ctrl+= in,
  // Ctrl+- out, Ctrl+0 reset. Arabic layouts remap these keys — the
  // pills in Settings stay the layout-free path, like every control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        resetZoom();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoomIn, zoomOut, resetZoom]);

  const showSettingsError = (error: unknown) => {
    const raw = typeof error === "string" ? error : String(error);
    setDialogTitle(t.dialog.somethingWrong);
    setDialogBody(t.dialog.unknownErrorBody(raw));
    setDialogKey("settings-write-failed");
  };

  // apply the resolved theme to <html> and follow OS changes while "auto"
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(themeSetting, mq.matches);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [themeSetting]);

  const onThemeChange = (v: ThemeSetting) => {
    const previous = themeSetting;
    setThemeSetting(v);
    void api.setTheme(v).catch((error) => {
      setThemeSetting(previous);
      showSettingsError(error);
    });
  };

  const onShowUnsupportedChange = (v: boolean) => {
    const previous = showUnsupported;
    setShowUnsupported(v);
    void api.setShowUnsupported(v).catch((error) => {
      setShowUnsupported(previous);
      showSettingsError(error);
    });
  };
  /** PowerShell probe result — true = limited mode banner on the monitor */
  const [psLimited, setPsLimited] = useState(false);

  // quiet startup update check — the ENGINE does the asking (Rust, blocking
  // pool, allowlisted hosts). The UI only decides whether to show the modal.
  useEffect(() => {
    let cancelled = false;
    api
      .checkUpdate()
      .then((info) => {
        if (cancelled || !info) return;
        setUpdateInfo(info);
      })
      .catch(() => {}); // offline/unavailable — silence, exactly like today
    return () => {
      cancelled = true;
    };
  }, []);

  // the once-per-version rule (pure logic in updateFlow.ts). Gated by
  // onboardingDone: a FIRST-RUN user must never meet the update modal —
  // not over the welcome screen, not over the advice dialog that follows
  // it. The version is announced only when the modal truly shows.
  useEffect(() => {
    if (!updateInfo || onboardingDone !== true) return;
    void api
      .updateAlreadyAnnounced(updateInfo.version)
      .then((announced) => {
        if (
          shouldShowUpdateModal(
            updateInfo,
            firstRunAdviceUp || gameAdviceUp || backgroundAdviceUp,
            announced ? updateInfo.version : null,
          )
        ) {
          setUpdateModal(true);
          void api.announceUpdate(updateInfo.version).catch(() => {});
        }
      })
      .catch(() => {});
  }, [updateInfo, firstRunAdviceUp, gameAdviceUp, backgroundAdviceUp, onboardingDone]);

  // state pushes land here (live + final): a finished session caused by
  // GameLoop dying gets its explanation dialog — once per session, never
  // for manual stops or the auto-stop timer (those need no apology).
  // Kept fresh through a ref: the engine-state subscription is registered
  // ONCE below, but reads the latest handler — so `t` and the once-per-
  // session flag can never go stale (language switch mid-session included).
  const handleStateRef = useRef<(p: StatusPayload) => void>(() => {});
  const handleState = (payload: StatusPayload) => {
    setStatus(payload);
    if (
      payload.status === "finished" &&
      payload.stop_reason === "gameloop_closed" &&
      !closedNoticeShown
    ) {
      setDialogTitle(t.dialog.gameloopClosed);
      setDialogBody(t.dialog.gameloopClosedBody);
      setDialogKey("gameloop_closed");
      setClosedNoticeShown(true);
    }
  };
  useEffect(() => {
    handleStateRef.current = handleState;
  });

  // initial state + live pushes + saved preferences + gameloop watcher
  useEffect(() => {
    // subscribe first, snapshot second: the subscriber stays attached for
    // the whole flight, so the last write wins and the snapshot only fills
    // whatever arrived before it.
    const un = onEngineState((ev) => {
      handleStateRef.current(ev.payload);
    }).catch(() => null);
    api
      .getState()
      .then(setStatus)
      .catch((e) => {
        // a novel failure gets the localized unknown-error dialog, never
        // a raw English string inside an Arabic UI
        const raw = typeof e === "string" ? e : String(e);
        setDialogTitle(t.dialog.somethingWrong);
        setDialogBody(t.dialog.unknownErrorBody(raw));
        setDialogKey(`state:${raw}`);
      });
    api
      .getSettings()
      .then((s) => {
        setDurationSecs(s.auto_stop_minutes * 60);
        setCollapsed(s.sidebar_collapsed);
        setShowUnsupported(s.show_unsupported ?? false);
        setOnboardingDone(s.onboarding_done);
        setGameAdviceDone(s.game_advice_done);
        setBackgroundAdviceDone(s.background_advice_done);
        const th = s.theme;
        // anything the backend doesn't recognize falls back to "auto"
        // (follow the OS) — the same rule normalize_theme applies in Rust
        setThemeSetting(th === "light" || th === "dark" ? th : "auto");
        // remember: was onboarding ALREADY done before this launch?
        if (s.onboarding_done) wasOnboardedRef.current = true;
      })
      .catch(() => {
        setCollapsed(false);
        setOnboardingDone(true);
        setGameAdviceDone(true);
        setBackgroundAdviceDone(true);
        wasOnboardedRef.current = true;
      });
    api
      .psAvailable()
      .then((ok) => setPsLimited(!ok))
      .catch(() => setPsLimited(false)); // probe failure ≠ limited claim
    // the one version ask for the whole app (titlebar + about share it)
    api
      .getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(""));
    // start the engine's idle GameLoop watcher. Its `engine://gameloop`
    // events have no UI consumer yet (the Start button stays pressable and
    // the engine gate answers on press) — but the WATCHER itself must run:
    // it keeps the session-start gate's emulator snapshot warm.
    void api.watchGameloop();
    return () => {
      un.then((f) => f?.());
    };
    // mount-once bootstrap: re-running on a language switch would re-fire
    // every startup query (the getState failure copy reads the boot locale
    // through the closure, which is fine).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseDuration = (secs: number) => {
    const previous = durationSecs;
    setDurationSecs(secs);
    void api.setAutoStop(Math.round(secs / 60)).catch((error) => {
      setDurationSecs(previous);
      showSettingsError(error);
    });
  };

  const toggleSidebar = () => {
    if (collapsed == null) return; // settings still loading — nothing to flip
    const previous = collapsed;
    const next = !collapsed;
    setCollapsed(next);
    void api.setSidebarCollapsed(next).catch((error) => {
      setCollapsed(previous);
      showSettingsError(error);
    });
  };

  const toggle = async () => {
    setBusy(true);
    try {
      if (status.status === "running") {
        setStatus(await api.sessionStop());
      } else {
        setStatus(await api.sessionStart(durationSecs));
      }
    } catch (e) {
      const raw = typeof e === "string" ? e : String(e);
      const d = errorDialog(raw, t.errors, {
        somethingWrong: t.dialog.somethingWrong,
        scanNeedsGame: t.dialog.scanNeedsGame,
        scanNeedsGameBody: t.dialog.scanNeedsGameBody,
        unknownErrorBody: t.dialog.unknownErrorBody,
      });
      setDialogTitle(d.title);
      setDialogBody(d.body);
      setDialogKey(d.key);
    } finally {
      setBusy(false);
    }
  };

  const openLatestReport = () => {
    setReportOpenId(status.ui?.session ?? "latest");
    setView("reports");
  };

  // stable identity: a new callback per render would re-trigger every
  // MonitorView effect that depends on it.
  const dismissSummary = useCallback((session: string) => {
    setDismissedSession(session);
  }, []);

  // FIRST-RUN advice: once, in the launch where the welcome flow completes
  // (previous launches never see it; dismissing unblocks the rest).
  useEffect(() => {
    if (onboardingDone && !firstRunAdviceShown && !wasOnboardedRef.current) {
      setFirstRunAdviceShown(true);
      setDialogTitle(t.dialog.firstRunAdvice);
      setDialogBody(t.dialog.firstRunAdviceBody);
      setDialogKey("first_run_advice");
    }
    // deliberate fire-once: firstRunAdviceShown guards the second run in state,
    // wasOnboardedRef guards it within the same render cycle; adding the
    // copy deps would re-arm the dialog on a mid-session language switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingDone]);

  // PRE-SCAN advice: once ever, on the first real session start. Never
  // blocks Start; defers behind other one-shot dialogs; persisted at show
  // (closing mid-dialog must not resurrect it) rather than at close.
  const wasRunningRef = useRef(false);
  /** the window was seen VISIBLE at least once in the current session —
      the background advice only fires on a visible→background TRANSITION,
      never on the starting state (pressing Start from an already-minimized
      game is expected, not a behavior worth nagging about) */
  const sawVisibleRef = useRef(false);
  useEffect(() => {
    const running = status.status === "running";
    const justStarted = running && !wasRunningRef.current;
    wasRunningRef.current = running;
    if (
      !justStarted ||
      onboardingDone !== true ||
      gameAdviceDone !== false ||
      firstRunAdviceUp ||
      backgroundAdviceUp
    ) {
      return;
    }
    setGameAdviceDone(true); // never again
    void api.finishGameAdvice().catch(() => {});
    setGameAdviceUp(true);
    setDialogTitle(t.dialog.gameAdviceTitle);
    setDialogBody(t.dialog.gameAdviceBody);
    setDialogKey("game_advice");
    // deliberate: the transition flags live in refs, and the copy deps
    // would re-fire the (already persisted) advice on language switches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, onboardingDone, gameAdviceDone, firstRunAdviceUp, backgroundAdviceUp]);

  // STAY-IN-GAME advice: once ever, on a measured visible-to-background
  // transition mid-session (never on the starting state). Skips if another
  // one-shot dialog owns the moment instead of queueing behind it.
  useEffect(() => {
    // track the transition, not the state: reset on session end so a new
    // session starts clean and can never inherit an old session's sighting
    if (status.status !== "running") {
      sawVisibleRef.current = false;
      return;
    }
    if (status.ui?.game_visible === true) {
      sawVisibleRef.current = true;
      return; // visible now — nothing to warn about
    }
    if (
      status.ui?.game_visible !== false ||
      onboardingDone !== true ||
      backgroundAdviceDone !== false ||
      firstRunAdviceUp ||
      gameAdviceUp ||
      !sawVisibleRef.current
    ) {
      return;
    }
    setBackgroundAdviceDone(true); // never again
    void api.finishBackgroundAdvice().catch(() => {});
    setBackgroundAdviceUp(true);
    setDialogTitle(t.dialog.backgroundAdviceTitle);
    setDialogBody(t.dialog.backgroundAdviceBody);
    setDialogKey("background_advice");
    // deliberate: same fire-once discipline as the game-advice effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, onboardingDone, backgroundAdviceDone, firstRunAdviceUp, gameAdviceUp]);

  // a session deleted from Reports must not linger as a "finished" state
  const effectiveStatus: StatusPayload =
    status.ui?.session != null && deletedSessions.includes(status.ui.session)
      ? { status: "idle", ui: null }
      : status;

  // hide every tooltip the moment the modal surface opens (a dialog
  // mounting under a parked cursor never fires mouseleave, leaving its
  // bubble stuck). APP_DIALOG additionally yields view-level dialogs.
  useEffect(() => {
    if (dialogKey || (updateModal && updateInfo) || exitConfirm) {
      window.dispatchEvent(new Event(MODAL_OPEN_EVENT));
    }
    if (dialogKey || exitConfirm) {
      window.dispatchEvent(new Event(APP_DIALOG_OPEN_EVENT));
    }
  }, [dialogKey, updateModal, updateInfo, exitConfirm]);

  const tabs: { id: View; icon: React.ReactNode; label: string; beta?: boolean }[] = [
    { id: "monitor", icon: <Crosshair size={17} />, label: t.monitor },
    { id: "system", icon: <Cpu size={17} />, label: t.system },
    { id: "processes", icon: <Activity size={17} />, label: t.topProcesses },
    { id: "checks", icon: <ShieldCheck size={17} />, label: t.systemHealth },
    { id: "tools", icon: <Wrench size={17} />, label: t.tools, beta: true },
    { id: "reports", icon: <FolderOpen size={17} />, label: t.reports },
    { id: "settings", icon: <Settings size={17} />, label: t.settings },
  ];

  return (
    <div className="shell">
      <TitleBar version={appVersion} onRequestExit={requestExit} updateAvailable={updateInfo != null} />
      <div className="shell-body">
        {/* null = settings still loading (IPC round-trip): show NOTHING
            decisive. The old bug rendered the main UI immediately, then
            swapped in the welcome screen seconds later — a flash of the
            full app on every first run. */}
        {onboardingDone == null ? null : onboardingDone === false ? (
          <main className="content">
            <WelcomeView
              onDone={() => {
                setOnboardingDone(true);
                void api.finishOnboarding().catch(() => {});
              }}
            />
          </main>
        ) : (
          <>
            {/* collapsed == null: settings still in flight — render nothing
                decisive (same pattern as onboarding above), so a saved-
                collapsed sidebar never flashes expanded on launch and vice
                versa. The frames are too short to read as a layout jump. */}
            {collapsed == null ? null : (
              <nav className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
                <div className="sb-label">{t.menu}</div>
                {tabs.map((tab) => (
                  <Tip
                    key={tab.id}
                    // collapsed rail hides the beta pill: the tooltip
                    // carries the signal instead (expanded labels show it)
                    text={collapsed ? (tab.beta ? `${tab.label} (${t.toolsBeta})` : tab.label) : ""}
                  >
                    <button
                      className={`sb-item ${view === tab.id ? "is-active" : ""}`}
                      // the active tab is announced as current (visual
                      // is-active styling is invisible to screen readers)
                      aria-current={view === tab.id ? "page" : undefined}
                      onClick={() => {
                        setReportOpenId(null);
                        setToolOpenId(null);
                        setView(tab.id);
                      }}
                    >
                      {tab.icon}
                      {!collapsed ? <span>{tab.label}</span> : null}
                      {/* beta pill: in-flow label (not the corner update
                          dot), hidden with the labels on the collapsed
                          rail; remove with the key when v2 goes stable */}
                      {!collapsed && tab.beta ? (
                        <span className="sb-beta">{t.toolsBeta}</span>
                      ) : null}
                    </button>
                  </Tip>
                ))}

                <Tip text={collapsed ? t.about : ""}>
                  <button
                    className={`sb-item ${view === "about" ? "is-active" : ""}`}
                    onClick={() => {
                      // like every tab: a pending deep-link must not
                      // survive a detour and fire on the way back
                      setReportOpenId(null);
                      setToolOpenId(null);
                      setView("about");
                    }}
                  >
                    <Info size={17} />
                    {!collapsed ? <span>{t.about}</span> : null}
                    {/* the update dot: hidden while About itself is open
                        (the heading dot carries the signal there — never
                        two yellows for one update) */}
                    {updateInfo && view !== "about" ? (
          <span
            className="sb-dot"
            // role+label: an aria-label on a plain span is invisible to
            // assistive tech — status announces it politely
            role="status"
            aria-label={t.updateAvailableTitle}
          />
        ) : null}
                  </button>
                </Tip>

                {/* spacer pushes the collapse control to the sidebar's floor */}
                <div className="sb-spacer" />

                {/* collapse control — pinned at the very bottom of the sidebar:
                    flips direction when collapsed; no tooltip while
                    expanded (the visible label says it already) */}
                <Tip text={collapsed ? t.expandMenu : ""}>
                  <button className="sb-collapse" onClick={toggleSidebar}>
                    {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
                    {!collapsed ? <span>{t.collapseMenu}</span> : null}
                  </button>
                </Tip>
              </nav>
            )}
            <main className="content">
              {/* every view mounts ONCE and stays alive; switching only flips
                  CSS visibility. Data-carrying tabs (system/processes/checks)
                  keep their state and never re-pay a PowerShell spawn per
                  visit — the engine's TTL cache handles freshness. */}
              <div className={view === "monitor" ? "" : "is-hidden-view"}>
                <MonitorView
                  status={effectiveStatus}
                  busy={busy}
                  durationSecs={durationSecs}
                  onDurationChange={chooseDuration}
                  onToggle={toggle}
                  onOpenReport={openLatestReport}
                  dismissedSession={dismissedSession}
                  onDismissSummary={dismissSummary}
                  psLimited={psLimited}
                />
              </div>
              <div className={view === "system" ? "" : "is-hidden-view"}>
                <SystemView />
              </div>
              <div className={view === "processes" ? "" : "is-hidden-view"}>
                <ProcessesView active={view === "processes"} />
              </div>
              <div className={view === "checks" ? "" : "is-hidden-view"}>
                <ChecksView
                  active={view === "checks"}
                  onOpenTool={(id) => {
                    setToolOpenId(id);
                    setView("tools");
                  }}
                />
              </div>
              <div className={view === "tools" ? "" : "is-hidden-view"}>
                <ToolsView
                  active={view === "tools"}
                  toolOpenId={toolOpenId}
                  onToolOpened={() => setToolOpenId(null)}
                  onCleaningChange={onCleaningActivity}
                  showUnsupported={showUnsupported}
                  onShowUnsupported={() => onShowUnsupportedChange(true)}
                />
              </div>
              <div className={view === "settings" ? "" : "is-hidden-view"}>
                <SettingsView theme={themeSetting} onThemeChange={onThemeChange} active={view === "settings"} zoom={zoom} onZoomChange={setZoomPct} showUnsupported={showUnsupported} onShowUnsupportedChange={onShowUnsupportedChange} />
              </div>
              <div className={view === "about" ? "" : "is-hidden-view"}>
                <AboutView
                  updateInfo={updateInfo}
                  version={appVersion}
                  onOpenUpdateModal={() => setUpdateModal(true)}
                  onUpdateFound={(info) => setUpdateInfo(info)}
                />
              </div>
              <div className={view === "reports" ? "" : "is-hidden-view"}>
                <ReportsView
                  active={view === "reports"}
                  openId={reportOpenId}
                  onOpened={() => setReportOpenId(null)}
                  onDeleted={(id) => markDeleted([id])}
                  onDeletedAll={(ids) => markDeleted(ids)}
                  runningSessionId={
                    effectiveStatus.status === "running" || effectiveStatus.status === "stopping"
                      ? (effectiveStatus.ui?.session ?? null)
                      : null
                  }
                />
              </div>
            </main>
          </>
        )}
      </div>

      {/* the ONE modal surface — no toast system anywhere in the app.
          Order matters: the exit confirm wins while up (the advice/error
          dialog is stateless, so hiding it is safe and it returns on
          Stay); the update modal stays mounted but suspended so a live
          download survives a Stay or an advice/error dialog instead of
          being cancelled by unmount. */}
      {exitConfirm ? (
        <Dialog
          title={t.dialog.exitTitle}
          body={[
            exitConfirm.scan ? t.dialog.exitBodyScan : "",
            exitConfirm.download ? t.dialog.exitBodyDownload : "",
            exitConfirm.cleaning ? t.dialog.exitBodyCleaning : "",
          ]
            .filter((s) => s !== "")
            .join(" ")}
          kind="confirm"
          danger
          confirmLabel={t.dialog.exitConfirm}
          cancelLabel={t.dialog.cancel}
          onConfirm={() => {
            void closeWindow();
          }}
          onClose={() => setExitConfirm(null)}
        />
      ) : dialogKey ? (
        <Dialog
          title={dialogTitle ?? t.dialog.somethingWrong}
          body={dialogBody ?? dialogKey}
          kind="notice"
          okLabel={t.dialog.ok}
          onClose={() => {
            // the one-forever advice dialogs were already persisted AT SHOW
            // (closing the app with the dialog open must not resurrect them
            // next launch) — closing only clears the modal surface here.
            // Reset by the FLAG, not by the current dialog value: a
            // gameloop_closed push can overwrite the dialog key while an advice
            // dialog is up, and a value-matched reset would leave the flag
            // stuck high for the whole launch, silently suppressing the
            // update modal (the deferral feeds on these flags).
            if (gameAdviceUp) setGameAdviceUp(false);
            if (backgroundAdviceUp) setBackgroundAdviceUp(false);
            setDialogKey(null);
            setDialogTitle(null);
            setDialogBody(null);
          }}
        />
      ) : null}
      {updateModal && updateInfo ? (
        <UpdateModal
          info={updateInfo}
          onClose={() => setUpdateModal(false)}
          onDownloadingChange={onDownloadActivity}
          suspended={exitConfirm !== null || dialogKey !== null}
        />
      ) : null}
    </div>
  );
}
