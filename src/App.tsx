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
import { Dialog, Tip } from "./components/components";
import { MonitorView } from "./views/MonitorView";
import { ReportsView } from "./views/ReportsView";
import { SystemView } from "./views/SystemView";
import { ProcessesView } from "./views/ProcessesView";
import { ChecksView } from "./views/ChecksView";
import { AboutView } from "./views/AboutView";
import { SettingsView } from "./views/SettingsView";
import { WelcomeView } from "./views/WelcomeView";
import { api, onEngineState, onGameloopChange, type StatusPayload, type UpdateInfo } from "./bridge";
import { useLang } from "./i18n";
import { errorDialog } from "./errors";
import { shouldShowUpdateModal } from "./updateFlow";
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
  const [gameloopUp, setGameloopUp] = useState<boolean | null>(null);
  const [collapsed, setCollapsed] = useState<boolean | null>(null); // null = loading saved pref
  /** first-run welcome: null = still loading the setting */
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  /** pre-scan advice ("close background apps"): shows ONCE EVER, the first
      time the app confirms the game is running; null = still loading */
  const [gameAdviceDone, setGameAdviceDone] = useState<boolean | null>(null);
  /** the pre-scan advice dialog is up (defers the update modal like the
      first-run advice does — one modal surface at a time) */
  const [gameAdviceUp, setGameAdviceUp] = useState(false);
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
  /** the session deleted from Reports — resets the whole finished state */
  const [deletedSession, setDeletedSession] = useState<string | null>(null);
  /** a newer version is available on GitHub (checked at startup, quietly) */
  /** a newer version is available on GitHub (checked at startup, quietly) */
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  /** the update modal: shown at startup (once per version) or via manual check */
  const [updateModal, setUpdateModal] = useState(false);
  /** first-run advice is up this launch — the update modal defers (one modal
      surface at a time; the advice has priority) */
  const [adviceUp, setAdviceUp] = useState(false);
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
            adviceUp || gameAdviceUp,
            announced ? updateInfo.version : null,
          )
        ) {
          setUpdateModal(true);
          void api.announceUpdate(updateInfo.version).catch(() => {});
        }
      })
      .catch(() => {});
  }, [updateInfo, adviceUp, gameAdviceUp, onboardingDone]);

  // state pushes land here (live + final): a finished session caused by
  // GameLoop dying gets its explanation dialog — once per session, never
  // for manual stops or the auto-stop timer (those need no apology).
  // Kept fresh through a ref: the engine-state subscription is registered
  // ONCE below, but reads the latest handler — so `t` and the once-per-
  // session flag can never go stale (language switch mid-session included).
  const handleStateRef = useRef<(p: StatusPayload) => void>(() => {});
  const handleState = (payload: StatusPayload) => {
    setStatus(payload);
    if (payload.status === "running") setGameloopUp(true);
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
        // remember: was onboarding ALREADY done before this launch?
        if (s.onboarding_done) wasOnboardedRef.current = true;
      })
      .catch(() => {
        setCollapsed(false);
        setOnboardingDone(true);
        wasOnboardedRef.current = true;
      });
    api
      .gameloopStatus()
      .then(setGameloopUp)
      .catch(() => setGameloopUp(false));
    api
      .psAvailable()
      .then((ok) => setPsLimited(!ok))
      .catch(() => setPsLimited(false)); // probe failure ≠ limited claim
    void api.watchGameloop();
    const un = onEngineState((ev) => {
      handleStateRef.current(ev.payload);
    }).catch(() => null);
    const un2 = onGameloopChange((up) => setGameloopUp(up)).catch(() => null);
    return () => {
      un.then((f) => f?.());
      un2.then((f) => f?.());
    };
  }, []);

  const chooseDuration = (secs: number) => {
    setDurationSecs(secs);
    void api.setAutoStop(Math.round(secs / 60)).catch(() => {});
  };

  const toggleSidebar = () => {
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
  // launch never see it.
  useEffect(() => {
    if (onboardingDone && !adviceShown && !wasOnboardedRef.current) {
      setAdviceShown(true);
      setAdviceUp(true); // the update modal defers while this is up
      setToastTitle(t.dialog.firstRunAdvice);
      setToastBody(t.dialog.firstRunAdviceBody);
      setToast("first_run_advice");
    } else if (onboardingDone) {
      // advice not showing this launch — the modal may show after all
      setAdviceUp(false);
    }
  }, [onboardingDone]);

  // the PRE-SCAN advice: the first time EVER the app confirms the game is
  // running (initial probe, watcher, or a started session — any source),
  // show the close-background-apps tip once. Never blocks Start: a session
  // can begin while the dialog is up; it just waits for a click.
  // One-modal rule: not over the welcome, not over the first-run advice.
  useEffect(() => {
    if (
      gameloopUp !== true ||
      onboardingDone !== true ||
      gameAdviceDone !== false ||
      adviceUp
    ) {
      return;
    }
    setGameAdviceDone(true); // never again — even if closed without a click
    setGameAdviceUp(true);
    setToastTitle(t.dialog.gameAdviceTitle);
    setToastBody(t.dialog.gameAdviceBody);
    setToast("game_advice");
  }, [gameloopUp, onboardingDone, gameAdviceDone, adviceUp]);

  // a session deleted from Reports must not linger as a "finished" state
  const effectiveStatus: StatusPayload =
    deletedSession && status.ui?.session === deletedSession
      ? { status: "idle", ui: null }
      : status;

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
                  gameloopUp={gameloopUp}
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
                <SettingsView />
              </div>
              <div className={view === "about" ? "" : "is-hidden-view"}>
                <AboutView
                  updateInfo={updateInfo}
                  onOpenUpdateModal={() => setUpdateModal(true)}
                />
              </div>
              <div className={view === "reports" ? "" : "is-hidden-view"}>
                <ReportsView
                  active={view === "reports"}
                  openId={reportOpenId}
                  onOpened={() => setReportOpenId(null)}
                  onDeleted={(id) => setDeletedSession(id)}
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
            // the pre-scan advice is one-forever: persist its dismissal
            if (toast === "game_advice") {
              setGameAdviceUp(false);
              void api.finishGameAdvice().catch(() => {});
            }
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
