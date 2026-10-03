// ReportsView.tsx –” saved sessions list + in-app friendly report reader.
// Content comes from the engine (keys + English fallbacks); the UI translates.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Clock, FileText, FileWarning, Folder, RefreshCw, Trash2 } from "lucide-react";
import { Button, Dialog, EmptyState, Hint, NoteCard, Tip, diagnosisIcon, APP_DIALOG_OPEN_EVENT } from "../components/components";
import { api, type FriendlyReport, type SessionEntry } from "../bridge";
import { useLang } from "../i18n";

/** moment dot severity from the engine kind (no backend change — the
    kinds are a closed, documented set): sustained drops read danger,
    load warnings read warn, session notes stay neutral. Unknown future
    kinds read warn (a highlight the engine bothered to emit is worth a
    glance, never a muted shrug). */
function highlightTone(kind: string): "hl-bad" | "hl-warn" | "" {
  switch (kind) {
    case "spike":
    case "cpu_saturation":
    case "gpu_activity_cliff":
    case "gpu_activity_cliff_loaded":
    case "hard_faults":
      return "hl-bad";
    case "nothing":
    case "noSamples":
    case "mostly_background":
      return "";
    default:
      return "hl-warn";
  }
}

/** "Xm Ys" report-row duration –” a deliberately different shape from the
 *  live session's mm:ss clock (this one reads naturally in a list row).
 *  Units come from the locale (Latin m/s read as English inside Arabic
 *  rows). */
function fmtDur(sec: number, units: { m: string; s: string }) {
  if (sec <= 0) return "--";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}${units.m} ${s}${units.s}` : `${s}${units.s}`;
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
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  /** key moments collapse (same toggle as the monitor feed, open by
      default: a report is a record, hiding its moments takes a tap) */
  const [momentsOpen, setMomentsOpen] = useState(true);

  const outcomeMeta: Record<string, { label: string; tone: "ok" | "bad" | "warn" }> = {
    clean: { label: t.clean, tone: "ok" },
    issues: { label: t.findings, tone: "warn" },
    laggy: { label: t.lagCaptured, tone: "bad" },
    partial: { label: t.partial, tone: "warn" },
  };

  /** LOAD failures (the list itself) are a PAGE state: EmptyState + retry,
      per the app's one-modal-surface rule - an action failure must never
      grab the modal while the page itself can carry the bad news. ACTION
      failures (open report, delete, open folder) are dialogs: the user
      asked for something and it did not happen; that deserves the one
      modal surface, exactly like the Tools tab's failed-write notice. */
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  /** action-failure notice body (null = no notice) */
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => {
    api
      .sessionEntries()
      .then((e) => {
        setEntries(e);
        setLoadFailed(null);
      })
      .catch((e) => {
        const raw = typeof e === "string" ? e : String(e);
        setLoadFailed(t.dialog.unknownErrorBody(raw));
      });
  };

  /** an action failed: localized copy + the raw message as a technical
      line, shown as the view's Dialog (never bare English, never inline) */
  const actionFailed = (e: unknown) => {
    const raw = typeof e === "string" ? e : String(e);
    setNotice(t.dialog.unknownErrorBody(raw));
  };

  // mount-time fetch only; the visibility effect and the deep-link below
  // own every later attempt - refresh's identity is not part of the contract
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, []);

  // The view stays MOUNTED (tab switch = CSS visibility only), so a session
  // that just finished would never appear without this: re-read the list
  // every time the tab becomes visible - the report of the session the user
  // just ran is there the moment they switch to it.
  useEffect(() => {
    if (active) refresh();
    // same as above: the interval-of-visibility contract reads `active`,
    // refresh re-resolves t/refs through the fresh closure each fire
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // deep-link: "Open full report" on the Monitor tab jumps here + opens the session.
  // The link can arrive with a STALE list (the tab refreshes on visibility,
  // so a just-finished session is never in it yet): a first miss triggers
  // one fresh re-read and resolves on it. Only a miss on the fresh list
  // reports "no longer saved".
  const linkRetriedRef = useRef(false);
  useEffect(() => {
    if (!openId) linkRetriedRef.current = false;
  }, [openId]);

  useEffect(() => {
    if (openId && entries) {
      if (!entries.some((e) => e.id === openId)) {
        if (!linkRetriedRef.current) {
          linkRetriedRef.current = true;
          setLoadingId(openId);
          refresh();
          return;
        }
        setLoadingId(null);
        // the linked session is gone (deleted meanwhile): say so instead
        // of silently opening somebody else's report. An empty list with
        // the "latest" fallback link is not an error - just clear it.
        // onOpened() must still fire: the App-level link is one-shot, and
        // leaving it set would re-raise this error on every list refresh.
        if (entries.length > 0) {
          setNotice(t.reportNotFound);
        }
        onOpened();
        return;
      }
      const target = openId;
      setLoadingId(target);
      api
        .loadReport(target)
        .then(setReport)
        .catch(actionFailed)
        .finally(() => {
          setLoadingId(null);
          onOpened();
        });
    }
    // deliberate: the deep-link runs once per openId/entries change; the
    // copy deps would re-run a finished deep-link on a language switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, entries]);

  const openReport = (id: string) => {
    setLoadingId(id);
    setNotice(null);
    api
      .loadReport(id)
      .then(setReport)
      .catch(actionFailed)
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
      actionFailed(e);
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
      actionFailed(e);
    }
  };

  const openRootFolder = async () => {
    try {
      // the ENGINE names the sessions root - no path string surgery in
      // the UI (the old lastIndexOf("\") derivation assumed a flat
      // layout). The buttons render only with saved sessions, but the
      // engine names the folder regardless.
      const root = await api.sessionsRoot();
      if (!root) return;
      await api.openPath(root);
    } catch (e) {
      actionFailed(e);
    }
  };

  // one modal surface, app-wide: when the App-level dialog (gameloop
  // closed, an advice, an error) opens while OUR delete confirmation is
  // up, two overlays stack and one Escape keydown closes BOTH. App
  // broadcasts APP_DIALOG_OPEN_EVENT for exactly this class of moment -
  // our confirmation yields (the delete is re-askable, the pushed dialog
  // is not). No state is destroyed: closing the confirm is a plain cancel.
  useEffect(() => {
    if (!confirmDelete && !confirmDeleteAll) return;
    const onAppDialog = () => {
      setConfirmDelete(null);
      setConfirmDeleteAll(false);
    };
    window.addEventListener(APP_DIALOG_OPEN_EVENT, onAppDialog);
    return () => window.removeEventListener(APP_DIALOG_OPEN_EVENT, onAppDialog);
  }, [confirmDelete, confirmDeleteAll]);

  // ---- report reader ------------------------------------------------
  if (report) {
    const meta = outcomeMeta[report.outcome] ?? outcomeMeta.partial;
    // findings carry keys –” translate; fall back to the backend's English text
    return (
      <div className="reports">
        <button className="back-btn" onClick={() => setReport(null)}>
          <ArrowLeft size={16} />
          {t.allSessions}
        </button>

        <div className="card report-head">
          <div className="report-head-title">
            <h2>{t.sessionReport}</h2>
            <p>
              {report.date} · {fmtDur(report.duration_sec, { m: t.minUnit, s: t.secUnit })} · {report.samples} {t.samples}
            </p>
          </div>
          <div className={`badge report-badge badge-${meta.tone}`}>
            {report.lag_spikes > 0 ? t.spikeCount(report.lag_spikes) : meta.label}
          </div>
        </div>

        {/* findings –” translated from engine keys */}
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
                  icon={diagnosisIcon(f.key)}
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

        {/* key moments –” composed in the user's language from raw facts,
            behind the same toggle as the monitor feed */}
        <section className="report-section">
          <h3>{t.keyMoments}</h3>
          <button
            type="button"
            className="feed-toggle"
            aria-expanded={momentsOpen}
            onClick={() => setMomentsOpen(!momentsOpen)}
          >
            <ChevronDown size={14} />
            {momentsOpen ? t.hideEventLog : t.showEventLog}
          </button>
          {momentsOpen ? (
            <ul className="card report-moments">
              {report.highlights.map((h, i) => {
                const base = t.highlights[h.kind] ?? h.kind;
                const clock = h.clock ? ` (${h.clock})` : "";
                const dur = h.dur_sec ? ` - ${fmtDur(Math.round(h.dur_sec), { m: t.minUnit, s: t.secUnit })}` : "";
                const tone = highlightTone(h.kind);
                return (
                  <li key={i} className={tone === "" ? undefined : tone}>
                    {`${base}${dur}${clock}`}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        {/* metrics in plain language –” composed from machine keys + numbers */}
        {report.metrics_summary.length > 0 ? (
          <section className="report-section">
            <h3>{t.theNumbers}</h3>
            <ul className="card report-metrics">
              {report.metrics_summary.map((m, i) => {
                const fmt = t.metrics[m.key];
                return (
                  <li key={i}>
                    {fmt ? fmt(Math.round(m.value)) : `${m.key}: ${m.value}`}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <div className="report-actions">
          <Button
            label={t.openReportFile}
            icon={<FileText size={15} />}
            variant="ghost"
              onClick={() => {
                // open the report file externally — an action, so a
                // failure lands in the notice dialog (never an unhandled
                // rejection leaving the user with a silently dead button)
                api.openPath(report.raw_path).catch(actionFailed);
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
      {loadFailed ? (
        // the LIST failed to load: a page state with a retry (never a
        // modal - the one surface stays free for action failures), same
        // shape as SystemView's honest error state
        <EmptyState
          icon={<FileWarning size={18} />}
          title={t.dialog.somethingWrong}
          hint={loadFailed}
        />
      ) : entries === null ? (
        <EmptyState icon={<RefreshCw size={20} />} title={t.loadingSessions} hint="" spin />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<FileWarning size={18} />}
          title={t.noSessions}
          hint={t.noSessionsHint}
        />
      ) : (
        <>
          {/* one-glance totals over the saved sessions: how many, and how
              many had issues (spikes or an issue/laggy outcome — a partial
              scan is interrupted, not an issue, so it stays out) */}
          <div className="card totals">
            <div className="total">
              <div className="total-num num">{entries.length}</div>
              <div className="total-label">{t.reportTotalSessions}</div>
            </div>
            <div className="total">
              <div className="total-num num total-warn">
                {
                  entries.filter(
                    (e) =>
                      e.lag_spikes > 0 || e.outcome === "issues" || e.outcome === "laggy",
                  ).length
                }
              </div>
              <div className="total-label">{t.reportTotalIssues}</div>
            </div>
          </div>
          <ul className="card session-list">
            {entries.map((e) => {
              const meta = outcomeMeta[e.outcome] ?? outcomeMeta.partial;
              return (
                <li key={e.id} className={loadingId === e.id ? "is-loading" : ""}>
                  {/* accessible row: a dedicated open button plus a delete
                      button, never nested interactives inside a clickable li */}
                  <button
                    type="button"
                    className="sl-open"
                    aria-label={`${e.date}, ${meta.label}`}
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
                        {fmtDur(e.duration_sec, { m: t.minUnit, s: t.secUnit })} · {e.samples} {t.samples}
                      </span>
                    </span>
                    <span className={`badge sl-badge sl-badge-${meta.tone}`}>
                      {e.lag_spikes > 0 ? t.spikeCount(e.lag_spikes) : meta.label}
                    </span>
                  </button>
                  <span className="sl-actions">
                    <Tip text={t.deleteSession}>
                      <button
                        type="button"
                        className="row-act sl-act sl-act-danger"
                        aria-label={t.deleteSession}
                        onClick={() => setConfirmDelete(e.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </Tip>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* one global folder button at the bottom of the sessions list -
          shown ONLY with saved sessions (a fresh user meets the empty
          state, not action buttons over an empty folder). The engine
          still names the root itself: no path string surgery here, and
          the button never depends on a session existing to derive it */}
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

      {/* delete confirmation –” the unified Dialog component */}
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

      {/* delete-all confirmation –” same Dialog, dynamic count in the body */}
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

      {/* action failure (open report / delete / open folder) - the
          unified Dialog, exactly like the Tools tab's failed-write
          notice: the user asked for something and it did not happen */}
      {notice ? (
        <Dialog
          title={t.dialog.somethingWrong}
          body={notice}
          kind="notice"
          okLabel={t.dialog.ok}
          onClose={() => setNotice(null)}
        />
      ) : null}

      {/* the notice yields to the app-level dialog, same as the confirms
          above - one modal surface, one Escape closing one thing */}
      <NoticeYield notice={notice} setNotice={setNotice} />
    </div>
  );
}

/** the APP_DIALOG_OPEN_EVENT subscription for the notice (a tiny
 *  component so the effect's deps stay honest without dragging the whole
 *  view into it) */
function NoticeYield(props: { notice: string | null; setNotice: (v: string | null) => void }) {
  const { notice, setNotice } = props;
  useEffect(() => {
    if (!notice) return;
    const onAppDialog = () => setNotice(null);
    window.addEventListener(APP_DIALOG_OPEN_EVENT, onAppDialog);
    return () => window.removeEventListener(APP_DIALOG_OPEN_EVENT, onAppDialog);
  }, [notice, setNotice]);
  return null;
}
