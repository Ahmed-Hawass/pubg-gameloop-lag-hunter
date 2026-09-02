// ProcessesView.tsx — who is eating the machine (the game is never a suspect).

import { useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { Button, EmptyState } from "../components/components";
import { api, type TopProcess } from "../bridge";
import { useLang } from "../i18n";

export function ProcessesView() {
  const { t } = useLang();
  const [procs, setProcs] = useState<TopProcess[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      setProcs(await api.topProcesses());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="procs">
      <div className="procs-head">
        <p className="procs-hint">{t.topProcessesHint}</p>
        <Button
          label={busy ? t.topProcessesRefreshing : t.refresh}
          icon={<RefreshCw size={14} className={busy ? "spin" : ""} />}
          variant="ghost"
          disabled={busy}
          onClick={() => void load()}
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
