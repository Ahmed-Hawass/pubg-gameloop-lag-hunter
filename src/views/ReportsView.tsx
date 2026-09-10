// ReportsView.tsx — saved sessions list + in-app friendly report reader.
// Content comes from the engine (keys + English fallbacks); the UI translates.

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, Clock, FileText, FileWarning, Folder, Gauge, Trash2 } from "lucide-react";
import { Button, Dialog, EmptyState, Hint, NoteCard, Tip } from "../components/components";
import { api, type FriendlyReport, type SessionEntry } from "../bridge";
import { useLang } from "../i18n";

/** "Xm Ys" report-row duration — a deliberately different shape from the
 *  live session's mm:ss clock (this one reads naturally in a list row). */
function fmtDur(sec: number) {
  if (sec <= 0) return "--";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function ReportsView(props: {
  openId: string | null;
  onOpened: () => void;
  /** tells App which session was deleted (Monitor resets if it was showing it) */
  onDeleted?: (id: string) => void;
  /** bulk deletion completed (ids actually removed) */
  onDeletedAll?: (ids: string[]) => void;
  /** id of the currently-running session, if any (bulk delete disabled while set) */
  runningSessionId?: string | null;
  /** true while the Reports tab is the visible one */
  active?: boolean;
}) {
  const { openId, onOpened, onDeleted, onDeletedAll, runningSessionId, active } = props;
  const { t } = useLang();
  const [entries, setEntries] = useState<SessionEntry[] | null>(null);
  const [report, setReport] = useState<FriendlyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const outcomeMeta: Record<string, { label: string; tone: "ok" | "bad" | "mid" }> = {
    clean: { label: t.clean, tone: "ok" },
    issues: { label: t.findings, tone: "mid" },
    laggy: { label: t.lagCaptured, tone: "bad" },
    partial: { label: t.partial, tone: "mid" },
  };

  const refresh = () => {
    api
      .sessionEntries()
      .then(setEntries)
      .catch((e) => setError(String(e)));
  };

  useEffect(refresh, []);

  // The view stays MOUNTED (tab switch = CSS visibility only), so a session
  // that just finished would never appear without this: re-read the list
  // every time the tab becomes visible — the report of the session the user
  // just ran is there the moment they switch to it.
  useEffect(() => {
    if (active) refresh();
  }, [active]);

  // deep-link: "Open full report" on the Monitor tab jumps here + opens the session
  useEffect(() => {
    if (openId && entries) {
      if (!entries.some((e) => e.id === openId)) {
        // the linked session is gone (deleted meanwhile): say so instead
        // of silently opening somebody else's report. An empty list with
        // the "latest" fallback link is not an error — just clear it.
        // onOpened() must still fire: the App-level link is one-shot, and
        // leaving it set would re-raise this error on every list refresh.
        if (entries.length > 0) {
          setError(t.reportNotFound);
        }
        onOpened();
        return;
      }
      const target = openId;
      setLoadingId(target);
      api
        .loadReport(target)
        .then(setReport)
        .catch((e) => setError(String(e)))
        .finally(() => {
          setLoadingId(null);
          onOpened();
        });
    }
  }, [openId, entries]);

  const openReport = (id: string) => {
    setLoadingId(id);
    setError(null);
    api
      .loadReport(id)
      .then(setReport)
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingId(null));
  };

  const removeSession = async (id: string) => {
    try {
      await api.deleteSession(id);
      setConfirmDelete(null);
      if (report?.id === id) setReport(null);
      onDeleted?.(id);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const removeAllSessions = async () => {
    try {
      const ids = await api.deleteAllSessions(runningSessionId ?? null);
      setConfirmDeleteAll(false);
      setReport(null);
      onDeletedAll?.(ids);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const openRootFolder = async () => {
    try {
      const any = entries?.[0];
      if (!any) return;
      const p = await api.sessionFolder(any.id);
      const idx = p.lastIndexOf("\\");
      if (idx <= 0) return; // no parent separator — never open a bogus path
      const root = p.substring(0, idx);
      if (!root) return;
      await api.openPath(root);
    } catch (e) {
      setError(String(e));
    }
  };

  // ---- report reader ------------------------------------------------
  if (report) {
    const meta = outcomeMeta[report.outcome] ?? outcomeMeta.partial;
    // findings carry keys — translate; fall back to the backend's English text
    return (
      <div className="reports">
        <button className="reports-back" onClick={() => setReport(null)}>
          <ChevronLeft size={16} />
          {t.allSessions}
        </button>

        <div className="report-head">
          <div className="report-head-title">
            <h2>{t.sessionReport}</h2>
            <p>
              {report.date} · {fmtDur(report.duration_sec)} · {report.samples} {t.samples}
            </p>
          </div>
          <div className={`report-badge badge-${meta.tone}`}>
            {report.lag_spikes > 0 ? t.spikeCount(report.lag_spikes) : meta.label}
          </div>
        </div>

        {/* findings — translated from engine keys */}
        {report.findings.length > 0 ? (
          <section className="report-section">
            <h3>{t.whatWeFound}</h3>
            {report.findings.map((f, i) => {
              const copy = t.diagnoses[f.key] ?? { title: f.title, simple: f.simple, fix: f.fix };
              return (
                <NoteCard
                  key={i}
                  title={copy.title}
                  simple={copy.simple}
                  fix={copy.fix}
                  severity={f.severity}
                  fixLabel={t.fixLabel}
                />
              );
            })}
          </section>
        ) : (
          <section className="report-section">
            <h3>{t.whatWeFound}</h3>
            <EmptyState
              icon={<CheckCircle2 size={18} />}
              title={t.noIssuesCaptured}
              hint={t.noIssuesCapturedHint}
            />
          </section>
        )}

        {/* key moments — composed in the user's language from raw facts */}
        <section className="report-section">
          <h3>{t.keyMoments}</h3>
          <ul className="report-moments">
            {report.highlights.map((h, i) => {
              const base = t.highlights[h.kind] ?? h.kind;
              const clock = h.clock ? ` (${h.clock})` : "";
              const dur = h.dur_sec ? ` — ${Math.round(h.dur_sec)}s` : "";
              return <li key={i}>{`${base}${dur}${clock}`}</li>;
            })}
          </ul>
        </section>

        {/* metrics in plain language */}
        {report.metrics_summary.length > 0 ? (
          <section className="report-section">
            <h3>{t.theNumbers}</h3>
            <ul className="report-metrics">
              {report.metrics_summary.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="report-actions">
          <Button
            label={t.openReportFile}
            icon={<FileText size={15} />}
            variant="ghost"
            onClick={() => {
              void api.openPath(report.raw_path);
            }}
          />
        </div>
      </div>
    );
  }

  // ---- sessions list --------------------------------------------------
  return (
    <div className="reports">
      <div className="reports-title-row">
        <h2 className="reports-title">{t.sessions}</h2>
        <Hint text={t.sessionsHint} />
      </div>
      {error ? <div className="reports-error">{error}</div> : null}
      {entries === null ? (
        <EmptyState icon={<Gauge size={18} />} title={t.loadingSessions} hint="" />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<FileWarning size={18} />}
          title={t.noSessions}
          hint={t.noSessionsHint}
        />
      ) : (
        <ul className="session-list">
          {entries.map((e) => {
            const meta = outcomeMeta[e.outcome] ?? outcomeMeta.partial;
            return (
              <li
                key={e.id}
                className={loadingId === e.id ? "is-loading" : ""}
                onClick={() => openReport(e.id)}
              >
                <span className={`sl-icon sl-icon-${meta.tone}`}>
                  {meta.tone === "ok" ? (
                    <CheckCircle2 size={17} />
                  ) : meta.tone === "bad" ? (
                    <AlertTriangle size={17} />
                  ) : (
                    <Clock size={17} />
                  )}
                </span>
                <span className="sl-main">
                  <span className="sl-date">{e.date}</span>
                  <span className="sl-sub">
                    {fmtDur(e.duration_sec)} · {e.samples} {t.samples}
                  </span>
                </span>
                <span className={`sl-badge sl-badge-${meta.tone}`}>
                  {e.lag_spikes > 0 ? t.spikeCount(e.lag_spikes) : meta.label}
                </span>
                <span className="sl-actions">
                  <Tip text={t.deleteSession}>
                    <button
                      className="sl-act sl-act-danger"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setConfirmDelete(e.id);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </Tip>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* one global folder button at the bottom of the sessions list */}
      {entries && entries.length > 0 ? (
        <div className="reports-actions">
          <Button
            label={t.openSessionsFolder}
            icon={<Folder size={14} />}
            variant="ghost"
            onClick={() => openRootFolder()}
          />
          <Button
            label={t.deleteAllSessions}
            icon={<Trash2 size={14} />}
            variant="ghost"
            className="reports-delete-all"
            disabled={runningSessionId != null}
            onClick={() => setConfirmDeleteAll(true)}
          />
        </div>
      ) : null}

      {/* delete confirmation — the unified Dialog component */}
      {confirmDelete ? (
        <Dialog
          title={t.dialog.deleteTitle}
          body={t.dialog.deleteBody}
          kind="confirm"
          danger
          confirmLabel={t.dialog.delete}
          cancelLabel={t.dialog.cancel}
          okLabel={t.dialog.ok}
          onConfirm={() => {
            void removeSession(confirmDelete);
          }}
          onClose={() => setConfirmDelete(null)}
        />
      ) : null}

      {/* delete-all confirmation — same Dialog, dynamic count in the body */}
      {confirmDeleteAll ? (
        <Dialog
          title={t.dialog.deleteAllTitle}
          body={t.dialog.deleteAllBody(entries?.length ?? 0)}
          kind="confirm"
          danger
          confirmLabel={t.dialog.delete}
          cancelLabel={t.dialog.cancel}
          okLabel={t.dialog.ok}
          onConfirm={() => {
            void removeAllSessions();
          }}
          onClose={() => setConfirmDeleteAll(false)}
        />
      ) : null}
    </div>
  );
}
