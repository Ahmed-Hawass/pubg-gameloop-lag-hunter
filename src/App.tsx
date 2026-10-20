// App.tsx — shell: custom title bar + collapsible sidebar + all views.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Cpu,
  Crosshair,
  FolderOpen,
  CircleGauge,
  Settings,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { TitleBar } from "./components/TitleBar";
import { Dialog, dispatchAppDialogOpen, dispatchModalOpen } from "./components/components";
import { AppSidebar, type SidebarTab } from "./components/AppSidebar";
import { MonitorView } from "./views/MonitorView";
import { ReportsView } from "./views/ReportsView";
import { StartupSection } from "./views/StartupSection";
import { SystemView } from "./views/SystemView";
import { ProcessesView } from "./views/ProcessesView";
import { ChecksView } from "./views/ChecksView";
import { ToolsView } from "./views/ToolsView";
import { AboutView } from "./views/AboutView";
import { SettingsView } from "./views/SettingsView";
import { WelcomeView } from "./views/WelcomeView";
import { api, isWindowVisible, logFrontendInfo, onEngineState, onTrayExit, onTrayQuickScan, quitApp, revealWindow, setTrayActive, setTrayTooltip, showMainWindow, syncTrayLabels, type StatusPayload, type UpdateInfo } from "./bridge";
import {
  hasLiveResult,
  quickScanIntent,
  scanPercent,
  trayPercentToPush,
  TOOLTIP_STEP_PCT,
} from "./tray";
import { useLang } from "./i18n";
import { errorDialog } from "./errors";
import { shouldShowUpdateModal } from "./updateFlow";
import { resolveTheme, type ThemeSetting } from "./theme";
import { useUiZoom } from "./useUiZoom";
import { useExitGate } from "./useExitGate";
import { UpdateModal } from "./components/UpdateModal";

type View =
  | "monitor"
  | "system"
  | "processes"
  | "checks"
  | "tools"
  | "startup"
  | "reports"
  | "settings"
  | "about";

export default function App() {
  const { t, lang } = useLang();
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
  /** the GameLoop-closed notice: once per app launch, never on manual or
      auto stops (a second closed scan in the same launch is the same news) */
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
  /** exit confirm: owned by the gate hook (X names in-flight work) */
  const { exitConfirm, setExitConfirm, onDownloadActivity, onCleaningActivity, requestExit } =
    useExitGate(status);
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

  // Alt+F4 exits through the gate (quiet work quits, in-flight work
  // confirms): the backend cannot tell Alt+F4 apart from the taskbar close
  // button, so the split lives here where the keystroke is visible. X and
  // the taskbar button keep hiding. If the WebView ever swallows this
  // keystroke, the close falls back to a plain hide — never a quit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "F4") {
        e.preventDefault();
        requestExit();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestExit]);

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

  // the update modal reveals a hidden window instead of announcing itself
  // to nobody: a scan can run hidden to the tray while the startup check
  // lands, and the manual About check can fire from a hidden window too.
  const openUpdateModal = useCallback(() => {
    void isWindowVisible()
      .then((visible) => {
        if (!visible) void showMainWindow().catch(() => {});
      })
      .catch(() => {})
      .finally(() => setUpdateModal(true));
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
          openUpdateModal();
          void api.announceUpdate(updateInfo.version).catch(() => {});
        }
      })
      .catch(() => {});
  }, [updateInfo, firstRunAdviceUp, gameAdviceUp, backgroundAdviceUp, onboardingDone, openUpdateModal]);

  // state pushes land here (live + final): a finished session caused by
  // GameLoop dying gets its explanation dialog — once per app launch, never
  // for manual stops or the auto-stop timer (those need no apology).
  // Kept fresh through a ref: the engine-state subscription is registered
  // ONCE below, but reads the latest handler — so `t` and the once-per-
  // launch flag can never go stale (language switch mid-session included).
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
        // IPC dead: keep the loading shell (onboarding NOT marked done) so
        // a first-run user still sees Welcome once the backend answers,
        // instead of skipping it due to a transient failure.
        setCollapsed(false);
        setOnboardingDone(false);
        setGameAdviceDone(false);
        setBackgroundAdviceDone(false);
        wasOnboardedRef.current = false;
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
    void api.watchGameloop().catch(() => {});
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

  // true when the toggle landed (started or stopped), false when it raised
  // a dialog instead (the tray's silent start uses this to decide whether
  // the window needs to come back; the Monitor button ignores the answer).
  const toggle = async (): Promise<boolean> => {
    setBusy(true);
    try {
      if (status.status === "running") {
        setStatus(await api.sessionStop());
      } else {
        setStatus(await api.sessionStart(durationSecs));
      }
      return true;
    } catch (e) {
      const raw = typeof e === "string" ? e : String(e);
      if (raw.includes("SESSION_STOPPED_DURING_START")) {
        // the user stopped mid-startup: the stop already won and the start
        // correctly aborted, so there is nothing to report — refresh the
        // snapshot quietly instead of crying wolf with an error dialog
        await api
          .getState()
          .then(setStatus)
          .catch(() => {});
        return true;
      }
      const d = errorDialog(raw, t.errors, {
        somethingWrong: t.dialog.somethingWrong,
        scanNeedsGame: t.dialog.scanNeedsGame,
        scanNeedsGameBody: t.dialog.scanNeedsGameBody,
        unknownErrorBody: t.dialog.unknownErrorBody,
      });
      setDialogTitle(d.title);
      setDialogBody(d.body);
      setDialogKey(d.key);
      return false;
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
  // (memoized: tray effects depend on it, and a fresh object per render
  // would re-fire them with no state change).
  const effectiveStatus: StatusPayload = useMemo(
    () =>
      status.ui?.session != null && deletedSessions.includes(status.ui.session)
        ? { status: "idle", ui: null }
        : status,
    [status, deletedSessions],
  );

  // ---- tray wiring (the notification-area icon) ----
  // Labels live in the locales like every other string: push them on mount,
  // on every language switch, and whenever the scan item wording moves
  // (idle words, then Stop with the live percent in 5% steps). Percent
  // steps are the only frequent push, and the effect fires only when the
  // composed text actually changes, so the native menu is never rebuilt
  // mid-click over nothing. Failures are silent on purpose (the window path
  // still works when the icon is unavailable).
  // the label percent moves in the same 5% steps as the tooltip (one
  // number, two surfaces), so a scan pushes about twenty label updates,
  // never one per second.
  const trayScanLabel = (() => {
    const pct = scanPercent(effectiveStatus);
    if (pct === null) return t.trayQuickScan;
    const step = pct === 100 ? 100 : Math.floor(pct / TOOLTIP_STEP_PCT) * TOOLTIP_STEP_PCT;
    return t.trayStopScan(step);
  })();
  useEffect(() => {
    void syncTrayLabels({
      open: t.trayOpen,
      scan: trayScanLabel,
      exit: t.trayExit,
    }).catch(() => {});
  }, [t, lang, trayScanLabel]);

  // Tray icon color follows the same transition: green while measuring,
  // gray otherwise. One push per transition, never per tick.
  const trayBusy =
    effectiveStatus.status === "running" || effectiveStatus.status === "stopping";
  useEffect(() => {
    void setTrayActive(trayBusy).catch(() => {});
  }, [trayBusy]);

  // Live tooltip: the scan percent while running, a done line while a
  // verdict waits unread, the app name otherwise. Throttled by
  // trayPercentToPush (a push per state tick is an IPC flood), and the exact
  // text is never pushed twice in a row (idle, done, and each percent step
  // are distinct strings, so comparing text covers language switches and
  // idle-to-done turns with no extra bookkeeping).
  const trayLastSentRef = useRef<number | null>(null);
  const trayLastTextRef = useRef<string | null>(null);
  useEffect(() => {
    const next = trayPercentToPush(effectiveStatus, trayLastSentRef.current);
    if (next === null) return;
    const text =
      next === 0
        ? hasLiveResult(effectiveStatus, dismissedSession)
          ? t.trayTooltipDone
          : t.trayTooltipIdle
        : t.trayTooltipScanning(next);
    if (text === trayLastTextRef.current) return;
    trayLastSentRef.current = next;
    trayLastTextRef.current = text;
    void setTrayTooltip(text).catch(() => {});
  }, [effectiveStatus, dismissedSession, t]);

  // Tray menu events. An explicit Quick scan press always means a new
  // scan, even over an unread verdict (its report stays saved in Reports).
  // Silent while hidden: the window comes back only when it needs eyes (a
  // start failure that raises a dialog, or a scan already winding down).
  // Exit runs the gate (quiet work quits silently, in-flight work reveals
  // first and then confirms). Refs keep the subscription mount-once.
  const trayStatusRef = useRef(effectiveStatus);
  useEffect(() => {
    trayStatusRef.current = effectiveStatus;
  }, [effectiveStatus]);
  const trayToggleRef = useRef(toggle);
  useEffect(() => {
    trayToggleRef.current = toggle;
  });
  const trayOnboardingRef = useRef(onboardingDone);
  useEffect(() => {
    trayOnboardingRef.current = onboardingDone;
  }, [onboardingDone]);
  // A tray scan request already in flight (double-click on the menu):
  // the second press is dropped so it can never double a start or a stop.
  const trayOpRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    let unQuick: (() => void) | undefined;
    let unExit: (() => void) | undefined;
    void onTrayQuickScan(() => {
      if (cancelled || trayOpRef.current) return;
      const intent = quickScanIntent(trayStatusRef.current);
      if (intent === "stop") {
        // a scan is measuring: stop it silently while hidden (the done
        // tooltip later tells the user a verdict is waiting)
        trayOpRef.current = true;
        void logFrontendInfo("tray quick scan: stop").catch(() => {});
        void trayToggleRef.current().then((landed) => {
          trayOpRef.current = false;
          if (cancelled) return;
          void logFrontendInfo(`tray quick scan: stop done (landed=${landed})`).catch(() => {});
          if (!landed) {
            void revealWindow().catch(() => {});
            setView("monitor");
          }
        });
        return;
      }
      if (intent === "show") {
        // a scan winding down: the user pressed to see, so land on the
        // monitor in a visible window
        void logFrontendInfo("tray quick scan: show").catch(() => {});
        void revealWindow().catch(() => {});
        setView("monitor");
        return;
      }
      if (trayOnboardingRef.current !== true) {
        // welcome not finished: there is no session plan to run from, so
        // show the welcome flow instead of starting behind its back
        void logFrontendInfo("tray quick scan: show welcome").catch(() => {});
        void revealWindow().catch(() => {});
        return;
      }
      // silent start: stay hidden unless the toggle raises a dialog in
      // the hidden window, then reveal it and land on the monitor so the
      // failure is actually seen.
      trayOpRef.current = true;
      void logFrontendInfo(`tray quick scan: ${intent}`).catch(() => {});
      void trayToggleRef.current().then((landed) => {
        trayOpRef.current = false;
        if (cancelled) return;
        void logFrontendInfo(`tray quick scan: done (landed=${landed})`).catch(() => {});
        if (!landed) {
          void revealWindow().catch(() => {});
          setView("monitor");
        }
      });
    })
      .then((u) => {
        if (!cancelled) unQuick = u;
        else u();
      })
      .catch(() => {});
    void onTrayExit(() => {
      if (!cancelled) requestExit();
    })
      .then((u) => {
        if (!cancelled) unExit = u;
        else u();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unQuick?.();
      unExit?.();
    };
  }, [requestExit]);

  // hide every tooltip the moment the modal surface opens (a dialog
  // mounting under a parked cursor never fires mouseleave, leaving its
  // bubble stuck). APP_DIALOG additionally yields view-level dialogs.
  useEffect(() => {
    if (dialogKey || (updateModal && updateInfo) || exitConfirm) {
      dispatchModalOpen();
    }
    if (dialogKey || exitConfirm) {
      dispatchAppDialogOpen();
    }
  }, [dialogKey, updateModal, updateInfo, exitConfirm]);

  // No dialog may ever sit in a hidden window: a modal the user cannot see
  // is a dead app from their side (a stuck scan, a confirm nobody answers).
  // The dedicated paths above already reveal first, so this backstop only
  // fires for dialogs raised by state pushes (a game that died mid hidden
  // scan, a one-shot advice firing on a tray-started session). Rare by
  // construction: it runs only when a dialog surface appears.
  const modalUp = dialogKey !== null || exitConfirm !== null || (updateModal && updateInfo !== null);
  useEffect(() => {
    if (!modalUp) return;
    void isWindowVisible()
      .then((visible) => {
        if (!visible) void revealWindow().catch(() => {});
      })
      .catch(() => {});
  }, [modalUp]);

  const tabs: SidebarTab[] = useMemo(
    () => [
      { id: "monitor", icon: <Crosshair size={17} />, label: t.monitor },
      { id: "system", icon: <Cpu size={17} />, label: t.system },
      { id: "processes", icon: <Activity size={17} />, label: t.topProcesses },
      { id: "checks", icon: <ShieldCheck size={17} />, label: t.systemHealth },
      { id: "tools", icon: <Wrench size={17} />, label: t.tools },
      { id: "startup", icon: <CircleGauge size={17} />, label: t.startup },
      { id: "reports", icon: <FolderOpen size={17} />, label: t.reports },
      { id: "settings", icon: <Settings size={17} />, label: t.settings },
    ],
    [t],
  );

  return (
    <div className="shell">
      <TitleBar version={appVersion} />
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
              <AppSidebar
                t={t}
                tabs={tabs}
                view={view}
                collapsed={collapsed}
                updateInfo={updateInfo}
                onSelect={(id) => {
                  setReportOpenId(null);
                  setToolOpenId(null);
                  setView(id);
                }}
                onAbout={() => {
                  // like every tab: a pending deep-link must not
                  // survive a detour and fire on the way back
                  setReportOpenId(null);
                  setToolOpenId(null);
                  setView("about");
                }}
                onToggleSidebar={toggleSidebar}
              />
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
              <div className={view === "startup" ? "" : "is-hidden-view"}>
                <StartupSection active={view === "startup"} />
              </div>
              <div className={view === "settings" ? "" : "is-hidden-view"}>
                <SettingsView theme={themeSetting} onThemeChange={onThemeChange} active={view === "settings"} zoom={zoom} onZoomChange={setZoomPct} showUnsupported={showUnsupported} onShowUnsupportedChange={onShowUnsupportedChange} />
              </div>
              <div className={view === "about" ? "" : "is-hidden-view"}>
                <AboutView
                  updateInfo={updateInfo}
                  version={appVersion}
                  onOpenUpdateModal={openUpdateModal}
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
            void quitApp();
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
