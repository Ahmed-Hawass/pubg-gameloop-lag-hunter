// ProcessesView.tsx — who is eating the machine (the game is never a suspect).
// Stays live while the tab is open: silent refresh every few seconds (the
// engine's TTL cache decides whether a real query is needed).

import { useEffect, useRef, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { Button, EmptyState } from "../components/components";
import { api, type TopProcess } from "../bridge";
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

  const load = async (silent: boolean, force = false) => {
    if (busyRef.current) return; // never stack queries
    busyRef.current = true;
    if (!silent) setBusy(true);
    try {
      setProcs(await api.topProcesses(force));
      setError(null);
    } catch (e) {
      if (!silent) setError(String(e)); // polling failures stay quiet
    } finally {
      busyRef.current = false;
      if (!silent) setBusy(false);
    }
  };

  // first data
  useEffect(() => {
    void load(false);
  }, []);

  // live while this tab is the active one — paused otherwise
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void load(true), LIVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
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

      {error ? <div className="reports-error">{error}</div> : null}

      {procs === null ? (
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
