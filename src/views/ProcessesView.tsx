// ProcessesView.tsx — who is eating the machine (the game is never a suspect).
// A totals card answers "how bad is the background overall", then two
// groups: user apps (safe to close before playing) and system tasks
// (leave running). Stays live while the tab is open: silent refresh every
// few seconds (the engine's TTL cache decides whether a real query is
// needed).

import { useEffect, useRef, useState } from "react";
import { Activity, AppWindow, RefreshCw, Settings } from "lucide-react";
import { Button, EmptyState } from "../components/components";
import { api, type TopProcess, type TopProcesses } from "../bridge";
import { errorDialog } from "../errors";
import { useLang } from "../i18n";

/** live refresh cadence while the tab is visible */
const LIVE_INTERVAL_MS = 5000;

export function ProcessesView(props: { active: boolean }) {
  const { active } = props;
  const { t } = useLang();
  const [answer, setAnswer] = useState<TopProcesses | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // one pending slot for a manual press that lands mid-query (the Checks
  // tab's pattern): instead of swallowing the click silently while a
  // silent poll is in flight, the button spins immediately and the press
  // runs right after the in-flight query finishes — one click suffices
  const pendingManualRef = useRef(false);

  const load = async (silent: boolean, force = false) => {
    if (busyRef.current) {
      if (!silent) {
        pendingManualRef.current = true;
        setBusy(true);
      }
      return;
    }
    busyRef.current = true;
    if (!silent) setBusy(true);
    try {
      setAnswer(await api.topProcesses(force));
      setError(null);
    } catch (e) {
      // polling failures stay quiet; manual failures prefer the locale copy
      // for known backend keys, novel failures keep the raw technical line
      if (!silent) {
        const raw = typeof e === "string" ? e : String(e);
        setError(
          errorDialog(raw, t.errors, {
            somethingWrong: t.dialog.somethingWrong,
            scanNeedsGame: t.dialog.scanNeedsGame,
            scanNeedsGameBody: t.dialog.scanNeedsGameBody,
            unknownErrorBody: t.dialog.unknownErrorBody,
          }).body,
        );
      }
    } finally {
      busyRef.current = false;
      if (pendingManualRef.current) {
        pendingManualRef.current = false;
        void load(false, true);
      } else if (!silent) {
        setBusy(false);
      }
    }
  };

  // first data
  useEffect(() => {
    void load(false);
    // mount-time fetch only: the refresh button and the interval below
    // own every later attempt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // live while this tab is the active one — paused otherwise
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void load(true), LIVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // load reads busyRef/pendingManualRef (refs) and queues itself; its
    // identity is not part of the interval contract
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const procs = answer?.processes ?? null;
  const apps = procs?.filter((p) => p.kind === "app") ?? [];
  const system = procs?.filter((p) => p.kind !== "app") ?? [];

  return (
    <div className="procs">
      <div className="procs-head">
        <p className="procs-hint">{t.topProcessesHint}</p>
        <Button
          label={busy ? t.topProcessesRefreshing : t.refresh}
          icon={<RefreshCw size={14} className={busy ? "spin" : ""} />}
          variant="ghost"
          disabled={busy}
          onClick={() => void load(false, true)}
        />
      </div>

      {/* a LOAD failure is a page state (the retry above re-reads live
          every 5s anyway and on every press) — never a modal, never an
          inline red line: the one-modal surface stays for action
          failures, and this tab's only action is the refresh itself */}
      {error ? (
        <EmptyState
          icon={<Activity size={18} />}
          title={t.dialog.somethingWrong}
          hint={error}
        />
      ) : procs === null ? (
        <EmptyState icon={<Activity size={18} />} title={t.topProcessesRefreshing} hint="" />
      ) : procs.length === 0 ? (
        <EmptyState icon={<Activity size={18} />} title={t.topProcessesEmpty} hint="" />
      ) : (
        <>
          {/* background totals: the truncated list below can never show
              the whole load, so the header carries the honest sums */}
          <div className="card procs-totals">
            <div className="procs-total">
              <span className="procs-total-num num">{answer!.total_cpu.toFixed(1)}%</span>
              <span className="procs-total-label">{t.totalCpuBackground}</span>
            </div>
            <div className="procs-total">
              <span className="procs-total-num num">{Math.round(answer!.total_ram_mb)} MB</span>
              <span className="procs-total-label">{t.totalRamBackground}</span>
            </div>
          </div>
          {apps.length > 0 ? (
            <section className="proc-group">
              <h3 className="proc-group-head">
                <AppWindow size={15} />
                <span className="proc-group-text">
                  <span className="proc-group-title">{t.groupAppsTitle}</span>
                  <span className="proc-group-hint">{t.groupAppsHint}</span>
                </span>
              </h3>
              <ul className="card proc-list">
                {apps.map((p) => (
                  <ProcRow key={p.pid} proc={p} icon={<AppWindow size={15} />} />
                ))}
              </ul>
            </section>
          ) : null}
          {system.length > 0 ? (
            <section className="proc-group">
              <h3 className="proc-group-head">
                <Settings size={15} />
                <span className="proc-group-text">
                  <span className="proc-group-title">{t.groupSystemTitle}</span>
                  <span className="proc-group-hint">{t.groupSystemHint}</span>
                </span>
              </h3>
              <ul className="card proc-list">
                {system.map((p) => (
                  <ProcRow key={p.pid} proc={p} icon={<Settings size={15} />} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** one row: generic group tile (never brand artwork), name, numbers.
    Curated staples translate by key, everything else shows the engine's
    ProductName-or-raw string verbatim. */
function ProcRow(props: { proc: TopProcess; icon: React.ReactNode }) {
  const { proc: p, icon } = props;
  const { t } = useLang();
  const label =
    (p.display_key ? t.procNames[p.display_key] : undefined) ?? p.display_name;
  return (
    <li className="proc-row">
      <span className="icon-tile">{icon}</span>
      <span className="proc-name">{label}</span>
      <span className="proc-nums num">
        <span className="proc-cpu">{p.cpu_pct.toFixed(1)}%</span>
        <span className="proc-ram">{Math.round(p.ram_mb)} MB</span>
      </span>
    </li>
  );
}
