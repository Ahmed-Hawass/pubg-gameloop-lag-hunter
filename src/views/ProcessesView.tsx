// ProcessesView.tsx — who is eating the machine (the game is never a suspect).
// Stays live while the tab is open: silent refresh every few seconds (the
// engine's TTL cache decides whether a real query is needed).

import { useEffect, useRef, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { Button, EmptyState } from "../components/components";
import { api, type TopProcess } from "../bridge";
import { errorDialog } from "../errors";
import { useLang } from "../i18n";

/** live refresh cadence while the tab is visible */
const LIVE_INTERVAL_MS = 5000;

export function ProcessesView(props: { active: boolean }) {
  const { active } = props;
  const { t } = useLang();
  const [procs, setProcs] = useState<TopProcess[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // one pending slot for a manual press that lands mid-query (the Checks
  // tab's pattern): instead of swallowing the click silently while a
  // silent poll is in flight, the button spins immediately and the press
  // runs right after the in-flight query finishes
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
      setProcs(await api.topProcesses(force));
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
        <ul className="proc-list">
          {procs.map((p) => (
            <li key={p.pid} className="proc-row">
              <span className="proc-name">{p.name}</span>
              <span className="proc-bar">
                <span
                  className={`proc-fill ${p.cpu_pct >= 20 ? "bad" : p.cpu_pct >= 8 ? "warn" : "ok"}`}
                  style={{ width: `${Math.min(100, p.cpu_pct)}%` }}
                />
              </span>
              <span className="proc-cpu num">{p.cpu_pct.toFixed(1)}%</span>
              <span className="proc-ram num">{Math.round(p.ram_mb)} MB</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
