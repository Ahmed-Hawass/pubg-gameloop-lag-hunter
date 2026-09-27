// MonitorView.tsx — calm page: the layout is ALWAYS present (metrics, feed)
// in a neutral resting state. Live sessions fill them with real values.
// No status card/strip — the layout itself is the state.

import { useEffect, useState } from "react";
import { Brain, ChevronDown, Cpu, Database, Gamepad2, Play, Square } from "lucide-react";
import { Hint, Button, EmptyState, MetricCard, NoteCard, SummaryCard, Timeline, diagnosisIcon, fmtDur } from "../components/components";
import type { StatusPayload } from "../bridge";
import { useLang } from "../i18n";

export function MonitorView(props: {
  status: StatusPayload;
  busy: boolean;
  durationSecs: number;
  onDurationChange: (v: number) => void;
  onToggle: () => void;
  onOpenReport: () => void;
  /** the session whose summary the user dismissed (never show it again) */
  dismissedSession: string | null;
  onDismissSummary: (session: string) => void;
  /** PowerShell unavailable on this machine — limited mode */
  psLimited: boolean;
}) {
  const { status, busy, durationSecs, onDurationChange, onToggle, onOpenReport, dismissedSession, onDismissSummary, psLimited } = props;
  const { t } = useLang();
  const ui = status.ui;
  const running = status.status === "running";
  const finished = status.status === "finished";
  const sessionId = ui?.session ?? null;

  const durationLabel = (secs: number) => {
    if (secs === 300) return t.min5;
    if (secs === 600) return t.min10;
    if (secs === 1800) return t.min30;
    if (secs === 3600) return t.min60;
    // a stored duration outside the presets (e.g. migrated settings) —
    // localized like every other duration, never a bare English suffix
    return t.minutesShort(Math.round(secs / 60));
  };

  // the summary shows only while its session wasn't dismissed; auto-fades
  const summaryAllowed =
    finished && ui && ui.samples_count > 0 && sessionId !== null && sessionId !== dismissedSession;
  useEffect(() => {
    if (summaryAllowed) {
      const timer = setTimeout(() => onDismissSummary(sessionId!), 12_000);
      return () => clearTimeout(timer);
    }
  }, [summaryAllowed, sessionId, onDismissSummary]);

  // live values, or the neutral resting state for every card
  const liveUi = running ? ui : null;
  const bars = liveUi?.bars;
  // the event log collapses for a calm page; the choice survives ticks
  // (resetting it per render would yank an open log shut every second)
  const [feedOpen, setFeedOpen] = useState(true);

  return (
    <div className="monitor">
      {/* controls row: Start + duration + live clock.
          Start is always pressable — if the game isn't running, the engine
          gate answers and App shows the explaining dialog. */}
      <div className="controls">
        <Button
          label={running ? t.stop : t.startScanning}
          icon={running ? <Square size={16} /> : <Play size={16} />}
          variant={running ? "danger-filled" : "primary"}
          size="lg"
          disabled={busy || status.status === "stopping"}
          onClick={onToggle}
        />
        <div className="scan-duration" role="radiogroup" aria-label={t.autoStop}>
          {[300, 600, 1800, 3600].map((v) => (
            <button
              key={v}
              className={`scan-dur-btn ${durationSecs === v ? "is-active" : ""}`}
              role="radio"
              aria-checked={durationSecs === v}
              disabled={running}
              onClick={() => onDurationChange(v)}
            >
              {durationLabel(v)}
            </button>
          ))}
        </div>
        <div className="session-clock">
          <span className="timer-label">{t.time}</span>
          <span className="timer-val num">{fmtDur(liveUi?.elapsed_sec ?? 0)}</span>
        </div>
      </div>

      {/* metrics — always present; neutral until live. Each card carries a
          small corner tooltip explaining what it measures. */}
      <div className="metrics metrics-4">
        <MetricCard
          label={t.cpu}
          icon={<Cpu size={14} />}
          value={bars?.cpu ?? null}
          hint={t.cpuHint}
        />
        <MetricCard
          label={t.ram}
          icon={<Brain size={14} />}
          value={bars?.ram ?? null}
          hint={t.ramHint}
        />
        <MetricCard
          label={t.gpu}
          icon={<Gamepad2 size={14} />}
          value={bars?.gpu ?? null}
          hint={t.gpuHint}
        />
        <MetricCard
          label={t.disk}
          icon={<Database size={14} />}
          value={bars?.disk ?? null}
          hint={t.diskHint}
        />
      </div>

      {/* timeline — always present */}
      {liveUi ? (
        <>
          <Timeline
            elapsedSec={liveUi.elapsed_sec}
            autoStopSec={liveUi.auto_stop_sec}
            spikes={liveUi.spikes.map((s) => ({ offsetMs: s.offset_ms, kind: s.kind }))}
            hasData={liveUi.samples_count > 0}
            kindLabel={(k) => t.feed[k] ?? k}
            headLabel={t.timelineDuration}
            targetSec={liveUi.auto_stop_sec}
          />
          <div className="timeline-hint">
            <Hint text={t.timelineHint} />
          </div>
        </>
      ) : (
        <Timeline
          elapsedSec={0}
          autoStopSec={null}
          spikes={[]}
          hasData={false}
          kindLabel={(k) => t.feed[k] ?? k}
          headLabel={t.timelineDuration}
          targetSec={null}
        />
      )}

      {/* limited-mode note: PowerShell unavailable — scans still work, some
          checks run on safe defaults. Shown once per app run (not per tick). */}
      {psLimited ? (
        <div className="bg-note" role="note">
          <strong>{t.psLimitedTitle}:</strong> {t.psLimitedBody}
        </div>
      ) : null}

      {/* idle guidance: an empty layout explains nothing, so the calm
          state carries its own invitation (what to do, what happens) */}
      {!liveUi && !summaryAllowed ? (
        <EmptyState
          icon={<Play size={18} />}
          title={t.idleGuideTitle}
          hint={t.idleGuideHint}
        />
      ) : null}

      {/* confirmed diagnosis cards FIRST — what happened outranks the raw
          feed; only while the engine confirms them */}
      {liveUi && liveUi.diagnoses.length > 0 ? (
        <div className="notes">
          {liveUi.diagnoses.map((d) => {
            const copy = t.diagnoses[d.key] ?? { title: d.title, simple: d.simple, fix: d.fix };
            return (
              <NoteCard
                key={d.key}
                title={copy.title}
                simple={copy.simple}
                fix={copy.fix}
                severity={d.severity}
                fixLabel={t.fixLabel}
                icon={diagnosisIcon(d.key)}
              />
            );
          })}
        </div>
      ) : null}

      {/* activity feed — live only. A stopped scan has nothing streaming:
          idle shows the guidance panel above, finished shows the summary
          below, so an empty feed shell would be a third dead block. */}
      {liveUi ? (
        <section className="feed">
          <h3 className="feed-title">
            {t.activity}
            <Hint text={t.activityHint} />
          </h3>
          {liveUi.feed.length > 0 ? (
            <>
              <button
                type="button"
                className="feed-toggle"
                aria-expanded={feedOpen}
                onClick={() => setFeedOpen(!feedOpen)}
              >
                <ChevronDown size={14} />
                {feedOpen ? t.hideEventLog : t.showEventLog}
              </button>
              {feedOpen ? (
                <ul className="card feed-list">
                  {liveUi.feed.map((f, i) => (
                    // content-prefixed key with an index tiebreaker: rows are
                    // static text, so index shifting on prepend only repaints text
                    // while duplicates (same clock+kind+severity) stay unique
                    <li key={`${f.clock}-${f.kind}-${f.sev}-${i}`} className={`feed-item feed-${f.sev}`}>
                      <span className="feed-clock num">{f.clock}</span>
                      <span className="feed-text">{t.feed[f.kind] ?? f.kind}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <div className="feed-empty">
              {liveUi.game_running ? t.nothingUnusual : t.waitingGameloopFeed}
            </div>
          )}
        </section>
      ) : null}

      {/* after finish — its own session's summary, never the dismissed one */}
      {summaryAllowed ? (
        <div className="summary-wrap">
          <SummaryCard
            title={ui!.lag_count > 0 ? t.spikesCaptured(ui!.lag_count) : t.sessionClean}
            hint={t.summaryHint(ui!.samples_count)}
            reportLabel={t.openReportBtn}
            dismissLabel={t.dialog.dismiss}
            onReport={onOpenReport}
            onDismiss={() => onDismissSummary(sessionId!)}
          />
        </div>
      ) : null}
    </div>
  );
}
