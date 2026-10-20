// ProcessesView.tsx — who is eating the machine (the game is never a suspect).
// One actionable apps list: name over a muted RAM line per row, heaviest
// first, so the page reads as a decision ("close what you do not need")
// with the number that justifies it. No totals card. System tasks stay
// off-screen entirely (nothing here is guidance-free, every row ends).
// Stays live while the tab is open: silent refresh every few seconds (the
// engine's TTL cache decides whether a real query is needed).

import { useEffect, useRef, useState } from "react";
import { Activity, AppWindow, RefreshCw, RotateCw } from "lucide-react";
import { Button, Dialog, EmptyState } from "../components/components";
import { PageIntro } from "../components/sections";
import { useIntervalTick } from "../useIntervalTick";
import { api, type TopProcess, type TopProcesses } from "../bridge";
import { errorDialog, toErrorBody, type Notice } from "../errors";
import { useLang } from "../i18n";
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
        setError(toErrorBody(e, t));
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

  // live while this tab is the active one — paused otherwise, and while
  // the document is hidden (minimized window keeps polling otherwise).
  // Wiring lives in one hook; the silent body keeps its own busy guard.
  useIntervalTick(active, LIVE_INTERVAL_MS, () => void load(true));

  const procs = answer?.processes ?? null;
  // apps only on screen: nothing here is guidance-free, every row ends, and
  // a system task is not something the user can close anyway. The engine
  // still classifies every row; display just stops listing the leave-running
  // kind.
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
  /** real artwork by representative PID (glyph until it lands): asked
      once per new PID, kept across polls like the name cache */
  const [icons, setIcons] = useState<Record<number, string>>({});
  /** PIDs with an icon request in flight: a re-poll before the answer
      lands must not ask for the same artwork again (the list answer is a
      new object each time, so the effect does re-run) */
  const iconRequestsRef = useRef(new Set<number>());
  /** the request outlives an answer change: only a real unmount may drop
      its result (the PIDs are stable, so late art is still the right art) */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (apps.length === 0) return;
    const fresh = apps
      .map((p) => p.pids[0] ?? p.pid)
      .filter(
        (pid, i, all) =>
          pid > 0 &&
          !(pid in icons) &&
          !iconRequestsRef.current.has(pid) &&
          all.indexOf(pid) === i,
      );
    if (fresh.length === 0) return;
    for (const pid of fresh) iconRequestsRef.current.add(pid);
    void api
      .processIcons(fresh)
      .then((found) => {
        if (!mountedRef.current || found.length === 0) return;
        setIcons((prev) => {
          const next = { ...prev };
          for (const f of found) next[f.pid] = f.url;
          return next;
        });
      })
      .catch(() => {})
      .finally(() => {
        for (const pid of fresh) iconRequestsRef.current.delete(pid);
      });
    // icons keyed by PID: a re-poll with the same set asks nothing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer]);

  return (
    <div className="procs">
      {/* standing page header plus the one-shot card below it, above
          every state (loading, error, empty, and list): the title must
          never wait on the data */}
      <PageIntro
        id="processes"
        headerTitle={t.topProcesses}
        headerSub={t.procsAbout}
        cardTitle={t.introProcessesTitle}
        cardBody={t.introProcessesBody}
      />
      {/* a LOAD failure is a page state with a manual retry (the silent
          2s poll keeps running underneath) — never a modal, never an
          inline red line: the one-modal surface stays for action failures */}
      {error ? (
        <>
          <div className="procs-retry">
            <Button
              label={t.refresh}
              icon={<RefreshCw size={14} />}
              variant="ghost"
              onClick={() => void load(false, true)}
            />
          </div>
          <EmptyState
            icon={<Activity size={18} />}
            title={t.dialog.somethingWrong}
            hint={error}
          />
        </>
      ) : procs === null ? (
        <EmptyState icon={<RotateCw size={18} />} title={t.loading} hint="" spin />
      ) : apps.length === 0 ? (
        <EmptyState icon={<Activity size={18} />} title={t.topProcessesEmpty} hint="" />
      ) : (
        <>
          {/* one list, no group heading: a lone title above a lone list
              is a label for the obvious */}
          <ul className="card proc-list">
            {apps.map((p) => (
              <ProcRow
                key={p.pids[0] ?? p.pid ?? p.name}
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
    FileDescription-or-raw string verbatim. Name over a muted RAM line
    (same slot as the health state line, same tone): the row shows how
    much, the order shows how heavy. App rows carry an end-task action
    on the shared neutral button (danger lives only in the confirm);
    system rows carry no action by construction. */
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
        <span className="icon-tile icon-func">{glyph}</span>
      )}
      <span className="proc-text">
        <span className="proc-name">{label}</span>
        <span className="proc-ram num">{t.procRamUsage(p.ram_mb)}</span>
      </span>
      {onEnd ? (
        <button
          type="button"
          className="focus-ring row-act proc-end"
          disabled={ending}
          aria-label={`${ending ? endingLabel : endLabel} ${label}`}
          onClick={onEnd}
        >
          {ending ? endingLabel : endLabel}
        </button>
      ) : null}
    </li>
  );
}
