// App.tsx — shell: custom title bar + collapsible sidebar + all views.

import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { TitleBar } from "./components/TitleBar";
import { Dialog, MODAL_OPEN_EVENT, Tip } from "./components/components";
import { MonitorView } from "./views/MonitorView";
import { ReportsView } from "./views/ReportsView";
import { SystemView } from "./views/SystemView";
import { ProcessesView } from "./views/ProcessesView";
import { ChecksView } from "./views/ChecksView";
import { AboutView } from "./views/AboutView";
import { SettingsView } from "./views/SettingsView";
import { WelcomeView } from "./views/WelcomeView";
import { api, onEngineState, type StatusPayload, type UpdateInfo } from "./bridge";
import { useLang } from "./i18n";
import { errorDialog } from "./errors";
import { shouldShowUpdateModal } from "./updateFlow";
import { resolveTheme, type ThemeSetting } from "./theme";
import { UpdateModal } from "./components/UpdateModal";

type View = "monitor" | "system" | "processes" | "checks" | "reports" | "settings" | "about";

export default function App() {
  const { t } = useLang();
  const [status, setStatus] = useState<StatusPayload>({ status: "idle", ui: null });
  const [busy, setBusy] = useState(false);
  const [durationSecs, setDurationSecs] = useState<number>(300);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTitle, setToastTitle] = useState<string | null>(null);
  const [toastBody, setToastBody] = useState<string | null>(null);
  const [view, setView] = useState<View>("monitor");
  const [reportOpenId, setReportOpenId] = useState<string | null>(null);
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
  const [adviceShown, setAdviceShown] = useState(false);
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
  /** the update modal: shown at startup (once per version) or via manual check */
  const [updateModal, setUpdateModal] = useState(false);
  /** first-run advice is up RIGHT NOW — derived from the live toast state,
      never a sticky flag: the update modal and the one-shot advices defer
      while this dialog is on screen, and stop deferring the moment it is
      dismissed (a sticky boolean once deferred them for the whole launch) */
  const adviceUp = toast === "first_run_advice";
  /** theme setting ("auto" follows the OS — also the default for a fresh
      install); the resolved value drives
      document.documentElement.dataset.theme — single source of truth,
      SettingsView only sends changes through onThemeChange below */
  const [themeSetting, setThemeSetting] = useState<ThemeSetting>("auto");

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
    setThemeSetting(v);
    void api.setTheme(v).catch(() => {});
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
            adviceUp || gameAdviceUp || backgroundAdviceUp,
            announced ? updateInfo.version : null,
          )
        ) {
          setUpdateModal(true);
          void api.announceUpdate(updateInfo.version).catch(() => {});
        }
      })
      .catch(() => {});
  }, [updateInfo, adviceUp, gameAdviceUp, backgroundAdviceUp, onboardingDone]);

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
      setToastTitle(t.dialog.gameloopClosed);
      setToastBody(t.dialog.gameloopClosedBody);
      setToast("gameloop_closed");
      setClosedNoticeShown(true);
    }
  };
  useEffect(() => {
    handleStateRef.current = handleState;
  });

  // initial state + live pushes + saved preferences + gameloop watcher
  useEffect(() => {
    api
      .getState()
      .then(setStatus)
      .catch((e) => setToast(String(e)));
    api
      .getSettings()
      .then((s) => {
        setDurationSecs(s.auto_stop_minutes * 60);
        setCollapsed(s.sidebar_collapsed);
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
    // start the engine's idle GameLoop watcher. Its `engine://gameloop`
    // events have no UI consumer yet (the Start button stays pressable and
    // the engine gate answers on press) — but the WATCHER itself must run:
    // it keeps the session-start gate's emulator snapshot warm.
    void api.watchGameloop();
    const un = onEngineState((ev) => {
      handleStateRef.current(ev.payload);
    }).catch(() => null);
    return () => {
      un.then((f) => f?.());
    };
  }, []);

  const chooseDuration = (secs: number) => {
    setDurationSecs(secs);
    void api.setAutoStop(Math.round(secs / 60)).catch(() => {});
  };

  const toggleSidebar = () => {
    if (collapsed == null) return; // settings still loading — nothing to flip
    const next = !collapsed;
    setCollapsed(next);
    void api.setSidebarCollapsed(next).catch(() => {});
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
      });
      setToastTitle(d.title);
      setToastBody(d.body);
      setToast(d.key);
    } finally {
      setBusy(false);
    }
  };

  const openLatestReport = () => {
    setReportOpenId(status.ui?.session ?? "latest");
    setView("reports");
  };

  const dismissSummary = (session: string) => {
    setDismissedSession(session);
  };

  // the FIRST-RUN advice: appears exactly once — in the same launch where
  // the user completed the welcome flow. Users who onboarded in a previous
  // launch never see it. (adviceUp is derived from the live toast above, so
  // no reset logic is needed here — dismissing the dialog unblocks the rest.)
  useEffect(() => {
    if (onboardingDone && !adviceShown && !wasOnboardedRef.current) {
      setAdviceShown(true);
      setToastTitle(t.dialog.firstRunAdvice);
      setToastBody(t.dialog.firstRunAdviceBody);
      setToast("first_run_advice");
    }
  }, [onboardingDone]);

  // the PRE-SCAN advice: the first time EVER a session actually STARTS
  // (status flips idle -> running = the user pressed Start and the engine
  // gate confirmed the game), show the close-background-apps tip once.
  // Never blocks Start: the session is already running while the dialog
  // waits for a click. One-modal rule: not over the welcome, not over the
  // first-run advice (then it defers to the NEXT session start, not lost).
  // Persisted AT SHOW, not at close: closing the app with the dialog open
  // must not resurrect it next launch.
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
      adviceUp ||
      backgroundAdviceUp
    ) {
      return;
    }
    setGameAdviceDone(true); // never again
    void api.finishGameAdvice().catch(() => {});
    setGameAdviceUp(true);
    setToastTitle(t.dialog.gameAdviceTitle);
    setToastBody(t.dialog.gameAdviceBody);
    setToast("game_advice");
  }, [status, onboardingDone, gameAdviceDone, adviceUp, backgroundAdviceUp]);

  // the STAY-IN-GAME advice: the first time EVER a RUNNING session measures
  // the game window in the background, show the "stay inside the game" tip.
  // Fires only on a MEASURED false (never on null = probe not back yet) and
  // only mid-session. Waits for its turn behind the other one-shot dialogs —
  // if another advice is up when the moment arrives, this one skips: all of
  // these are one-forever, and the pre-scan advice already covers the topic.
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
      adviceUp ||
      gameAdviceUp ||
      !sawVisibleRef.current
    ) {
      return;
    }
    setBackgroundAdviceDone(true); // never again
    void api.finishBackgroundAdvice().catch(() => {});
    setBackgroundAdviceUp(true);
    setToastTitle(t.dialog.backgroundAdviceTitle);
    setToastBody(t.dialog.backgroundAdviceBody);
    setToast("background_advice");
  }, [status, onboardingDone, backgroundAdviceDone, adviceUp, gameAdviceUp]);

  // a session deleted from Reports must not linger as a "finished" state
  const effectiveStatus: StatusPayload =
    status.ui?.session != null && deletedSessions.includes(status.ui.session)
      ? { status: "idle", ui: null }
      : status;

  // tell every tooltip to hide the moment the modal surface opens: a dialog
  // mounting under a parked cursor never fires mouseleave, which used to
  // leave its bubble stuck above the modal (and after it closed) until the
  // user hovered the trigger again. Click-opened dialogs need no signal —
  // the hook already hides on pointerdown.
  useEffect(() => {
    if (toast || (updateModal && updateInfo)) {
      window.dispatchEvent(new Event(MODAL_OPEN_EVENT));
    }
  }, [toast, updateModal, updateInfo]);

  const tabs: { id: View; icon: React.ReactNode; label: string }[] = [
    { id: "monitor", icon: <Crosshair size={17} />, label: t.monitor },
    { id: "system", icon: <Cpu size={17} />, label: t.system },
    { id: "processes", icon: <Activity size={17} />, label: t.topProcesses },
    { id: "checks", icon: <ShieldCheck size={17} />, label: t.systemChecks },
    { id: "reports", icon: <FolderOpen size={17} />, label: t.reports },
    { id: "settings", icon: <Settings size={17} />, label: t.settings },
  ];

  return (
    <div className="shell">
      <TitleBar />
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
                  <Tip key={tab.id} text={collapsed ? tab.label : ""}>
                    <button
                      className={`sb-item ${view === tab.id ? "is-active" : ""}`}
                      onClick={() => {
                        setReportOpenId(null);
                        setView(tab.id);
                      }}
                    >
                      {tab.icon}
                      {!collapsed ? <span>{tab.label}</span> : null}
                    </button>
                  </Tip>
                ))}

                <Tip text={collapsed ? t.about : ""}>
                  <button
                    className={`sb-item ${view === "about" ? "is-active" : ""}`}
                    onClick={() => setView("about")}
                  >
                    <Info size={17} />
                    {!collapsed ? <span>{t.about}</span> : null}
                    {/* the update dot: not dismissible, present for the whole
                        life of the newer version — the silent signal behind
                        the once-per-version modal */}
                    {updateInfo ? <span className="sb-dot" aria-label={t.updateAvailableTitle} /> : null}
                  </button>
                </Tip>

                {/* spacer pushes the collapse control to the sidebar's floor */}
                <div className="sb-spacer" />

                {/* collapse control — pinned at the very bottom of the sidebar:
                    flips direction when collapsed */}
                <Tip text={collapsed ? t.expandMenu : t.collapseMenu}>
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
                <ChecksView active={view === "checks"} />
              </div>
              <div className={view === "settings" ? "" : "is-hidden-view"}>
                <SettingsView theme={themeSetting} onThemeChange={onThemeChange} />
              </div>
              <div className={view === "about" ? "" : "is-hidden-view"}>
                <AboutView
                  updateInfo={updateInfo}
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

      {/* the ONE modal surface — no toasts anywhere in the app.
          Order matters: the advice/error dialog wins over the update modal;
          the update modal (with its live download) wins over nothing else. */}
      {toast ? (
        <Dialog
          title={toastTitle ?? t.dialog.somethingWrong}
          body={toastBody ?? toast}
          kind="notice"
          okLabel={t.dialog.ok}
          onClose={() => {
            // the one-forever advice dialogs were already persisted AT SHOW
            // (closing the app with the dialog open must not resurrect them
            // next launch) — closing only clears the modal surface here
            if (toast === "game_advice") setGameAdviceUp(false);
            if (toast === "background_advice") setBackgroundAdviceUp(false);
            setToast(null);
            setToastTitle(null);
            setToastBody(null);
          }}
        />
      ) : updateModal && updateInfo ? (
        <UpdateModal info={updateInfo} onClose={() => setUpdateModal(false)} />
      ) : null}
    </div>
  );
}
