// ProcessesView.tsx — who is eating the machine (the game is never a suspect).
// A totals card answers "how bad is the background overall", then two
// groups: user apps (safe to close before playing) and system tasks
// (leave running). Stays live while the tab is open: silent refresh every
// few seconds (the engine's TTL cache decides whether a real query is
// needed).

import { useEffect, useRef, useState } from "react";
import { Activity, AppWindow, RefreshCw } from "lucide-react";
import { Dialog, EmptyState, IntroCard } from "../components/components";
import { api, type TopProcess, type TopProcesses } from "../bridge";
import { errorDialog, type Notice } from "../errors";
import { useLang } from "../i18n";
import { useIntroCard } from "../useIntroCard";
import { useModalSignal, useYieldToAppDialog } from "./tools/useModalSignals";

/** live refresh cadence while the tab is visible (native snapshot costs
    microseconds, no spawn: a 2s beat is cheaper than one old 5s poll) */
const LIVE_INTERVAL_MS = 2000;

export function ProcessesView(props: { active: boolean }) {
  const { active } = props;
  const { t } = useLang();
  const [answer, setAnswer] = useState<TopProcesses | null>(null);
  const [error, setError] = useState<string | null>(null);
  // overlap guard: a slow read never stacks a second one (the 2s beat
  // always wins over waiting: a skipped beat just serves the next one)
  const busyRef = useRef(false);

  const load = async (silent: boolean, force = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
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
    }
  };

  // first data
  useEffect(() => {
    void load(false);
    // mount-time fetch only: the interval below owns every later attempt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // live while this tab is the active one — paused otherwise
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void load(true), LIVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // load guards itself through busyRef; its identity is not part of
    // the interval contract
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const procs = answer?.processes ?? null;
  // apps only on screen (system rows stay in the honest totals above,
  // never as rows: nothing here is guidance-free, every row ends).
  // The engine still classifies every row; display just stops listing
  // the leave-running kind (one actionable list, no dead headers).
  const apps = procs?.filter((p) => p.kind === "app") ?? [];
  /** end-task confirm target (null = no confirm): app rows only, the
      Dialog names the app and warns about unsaved work */
  const [confirm, setConfirm] = useState<TopProcess | null>(null);
  /** per-row busy PID (null = idle): one kill at a time, other rows
      stay interactive throughout */
  const [endingPid, setEndingPid] = useState<number | null>(null);
  /** action failure notice on the one modal surface (load failures stay
      EmptyState above; this is only for the end-task attempt itself) */
  const [notice, setNotice] = useState<Notice | null>(null);
  const closeConfirm = () => setConfirm(null);
  const closeNotice = () => setNotice(null);
  useYieldToAppDialog(confirm !== null, closeConfirm);
  useYieldToAppDialog(notice !== null, closeNotice);
  useModalSignal(confirm !== null || notice !== null);

  const runEndTask = async (target: TopProcess) => {
    if (endingPid !== null) return;
    setEndingPid(target.pid);
    try {
      // the whole group goes: one worker alone never ends the app
      await api.endProcesses(target.pids.length > 0 ? target.pids : [target.pid]);
      setConfirm(null);
      // verify by re-read: the forced refresh shows the kill result
      await load(false, true);
    } catch (e) {
      const raw = typeof e === "string" ? e : String(e);
      const d = errorDialog(raw, t.errors, {
        somethingWrong: t.dialog.somethingWrong,
        scanNeedsGame: t.dialog.scanNeedsGame,
        scanNeedsGameBody: t.dialog.scanNeedsGameBody,
        unknownErrorBody: t.dialog.unknownErrorBody,
      });
      setConfirm(null);
      setNotice({ title: d.title, body: d.body });
    } finally {
      setEndingPid(null);
    }
  };
  /** one-shot page guidance (replaces the static header line): the
      close-before-playing decision for the single apps list. Transient
      states below keep no card. */
  const intro = useIntroCard("processes");
  /** real artwork by representative PID (glyph until it lands): asked
      once per new PID, kept across polls like the name cache */
  const [icons, setIcons] = useState<Record<number, string>>({});
  useEffect(() => {
    if (apps.length === 0) return;
    const fresh = apps
      .map((p) => p.pids[0] ?? p.pid)
      .filter((pid, i, all) => pid > 0 && !(pid in icons) && all.indexOf(pid) === i);
    if (fresh.length === 0) return;
    let live = true;
    void api
      .processIcons(fresh)
      .then((found) => {
        if (!live || found.length === 0) return;
        setIcons((prev) => {
          const next = { ...prev };
          for (const f of found) next[f.pid] = f.url;
          return next;
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // icons keyed by PID: a re-poll with the same set asks nothing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer]);

  return (
    <div className="procs">
      {intro.show ? (
        <IntroCard
          icon={<Activity size={16} />}
          title={t.introProcessesTitle}
          body={t.introProcessesBody}
          dismissLabel={t.dialog.dismiss}
          onDismiss={intro.dismiss}
        />
      ) : null}
      {/* a LOAD failure is a page state (the totals card below re-reads
          live every 2s; dead states with no data keep the silent poll
          plus refocus) — never a modal, never an inline red line: the
          one-modal surface stays for action failures */}
      {error ? (
        <EmptyState
          icon={<Activity size={18} />}
          title={t.dialog.somethingWrong}
          hint={error}
        />
      ) : procs === null ? (
        <EmptyState icon={<RefreshCw size={20} />} title={t.loading} hint="" spin />
      ) : apps.length === 0 ? (
        <EmptyState icon={<Activity size={18} />} title={t.topProcessesEmpty} hint="" />
      ) : (
        <>
          {/* background totals: the truncated list below can never show
              the whole load, so the header carries the honest sums */}
          <div className="card totals">
            <div className="total">
              <span className="total-num num">{answer!.total_cpu.toFixed(1)}%</span>
              <span className="total-label">{t.totalCpuBackground}</span>
            </div>
            <div className="total">
              <span className="total-num num">{Math.round(answer!.total_ram_mb)} MB</span>
              <span className="total-label">{t.totalRamBackground}</span>
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
                  <ProcRow
                    key={p.name}
                    proc={p}
                    art={icons[p.pids[0] ?? p.pid] ?? null}
                    glyph={<AppWindow size={15} />}
                    endLabel={t.endTask}
                    endingLabel={t.endingTask}
                    ending={endingPid === p.pid}
                    onEnd={() => setConfirm(p)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
      {/* destructive confirm: names the app and its size, unsaved work
          may be lost in every member */}
      {confirm ? (
        <Dialog
          title={t.endConfirmTitle(confirm.display_name)}
          body={
            confirm.pids.length > 1
              ? t.endConfirmBodyCount(confirm.display_name, t.procCount(confirm.pids.length))
              : t.endConfirmBody(confirm.display_name)
          }
          kind="confirm"
          danger
          confirmLabel={endingPid !== null ? t.endingTask : t.endTask}
          cancelLabel={t.dialog.cancel}
          onConfirm={() => void runEndTask(confirm)}
          onClose={() => {
            if (endingPid === null) setConfirm(null);
          }}
        />
      ) : null}
      {/* action failure: known keys get locale copy, novel ones ride the
          technical line (same errorDialog contract everywhere) */}
      {notice ? (
        <Dialog
          title={notice.title}
          body={notice.body}
          kind="notice"
          okLabel={t.dialog.ok}
          onClose={() => setNotice(null)}
        />
      ) : null}
    </div>
  );
}

/** one row: real artwork bare (no box) once
    resolved, the shared tile with the glyph until then. Curated staples
    translate by key, everything else shows the engine's
    FileDescription-or-raw string verbatim. App rows carry an end-task
    action on the shared neutral button (danger lives only in the
    confirm); system rows carry no action by construction. */
function ProcRow(props: {
  proc: TopProcess;
  art: string | null;
  glyph: React.ReactNode;
  endLabel?: string;
  endingLabel?: string;
  ending?: boolean;
  onEnd?: () => void;
}) {
  const { proc: p, art, glyph, endLabel, endingLabel, ending, onEnd } = props;
  const { t } = useLang();
  const label =
    (p.display_key ? t.procNames[p.display_key] : undefined) ?? p.display_name;
  return (
    <li className="proc-row">
      {art ? (
        <span className="proc-art">
          <img
            className="proc-icon"
            src={art}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        </span>
      ) : (
        <span className="icon-tile">{glyph}</span>
      )}
      <span className="proc-name">
        {label}
        {p.pids.length > 1 ? (
          <span className="proc-count">{t.procCount(p.pids.length)}</span>
        ) : null}
      </span>
      <span className="proc-nums num">
        <span className="proc-cpu">{p.cpu_pct.toFixed(1)}%</span>
        <span className="proc-ram">{Math.round(p.ram_mb)} MB</span>
      </span>
      {onEnd ? (
        <button
          type="button"
          className="row-act proc-end"
          disabled={ending}
          onClick={onEnd}
        >
          {ending ? endingLabel : endLabel}
        </button>
      ) : null}
    </li>
  );
}
