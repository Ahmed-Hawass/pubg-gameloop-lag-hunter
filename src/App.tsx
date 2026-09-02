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
import { api, onEngineState, onGameloopChange, type StatusPayload } from "./bridge";
import { useLang } from "./i18n";

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
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateUrl, setUpdateUrl] = useState<string | null>(null);

  // quiet startup update check — sets the About badge only, never interrupts.
  // version comes from the backend (tauri.conf.json) so it can never drift.
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    api
      .getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(""));
  }, []);

  useEffect(() => {
    if (!appVersion) return;
    fetch(`https://api.github.com/repos/Ahmed-Hawass/pubg-gameloop-lag-hunter/releases/latest?t=${Date.now()}`, {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { tag_name?: string; html_url?: string }) => {
        const remote = (d.tag_name ?? "").replace(/^v/, "");
        if (remote && remote !== appVersion) {
          setUpdateAvailable(true);
          setUpdateUrl(d.html_url ?? null);
        }
      })
      .catch(() => {});
  }, [appVersion]);

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
    void api.watchGameloop();
    const un = onEngineState((ev) => {
      handleState(ev.payload);
    }).catch(() => null);
    const un2 = onGameloopChange((up) => setGameloopUp(up)).catch(() => null);
    return () => {
      un.then((f) => f?.());
      un2.then((f) => f?.());
    };
  }, []);

  // state pushes land here (live + final): a finished session caused by
  // GameLoop dying gets its explanation dialog — once per session, never
  // for manual stops or the auto-stop timer (those need no apology)
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
      const code = Object.keys(t.errors).find((c) => raw.includes(c));
      if (code === "GAMELOOP_NOT_RUNNING") {
        setToastTitle(t.dialog.scanNeedsGame);
        setToastBody(t.dialog.scanNeedsGameBody);
        setToast(code);
      } else if (code) {
        setToastTitle(t.dialog.somethingWrong);
        setToastBody(t.errors[code]);
        setToast(code);
      } else {
        setToastTitle(t.dialog.somethingWrong);
        setToastBody(raw);
        setToast(raw);
      }
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
      setToastTitle(t.dialog.firstRunAdvice);
      setToastBody(t.dialog.firstRunAdviceBody);
      setToast("first_run_advice");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingDone]);

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
        {onboardingDone === false ? (
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
                <AboutView updateAvailable={updateAvailable} updateUrl={updateUrl} />
              </div>
              <div className={view === "reports" ? "" : "is-hidden-view"}>
                <ReportsView
                  openId={reportOpenId}
                  onOpened={() => setReportOpenId(null)}
                  onDeleted={(id) => setDeletedSession(id)}
                />
              </div>
            </main>
          </>
        )}
      </div>

      {/* the ONE modal surface — no toasts anywhere in the app */}
      {toast ? (
        <Dialog
          title={toastTitle ?? t.dialog.somethingWrong}
          body={toastBody ?? toast}
          kind="notice"
          okLabel={t.dialog.ok}
          onClose={() => {
            setToast(null);
            setToastTitle(null);
            setToastBody(null);
          }}
        />
      ) : null}
    </div>
  );
}
