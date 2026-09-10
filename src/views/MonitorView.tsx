// MonitorView.tsx — calm page: the layout is ALWAYS present (metrics, feed)
// in a neutral resting state. Live sessions fill them with real values.
// No status card/strip — the layout itself is the state.

import { useEffect } from "react";
import { Activity, Cpu, Gauge, HardDrive, Play, Square } from "lucide-react";
import { Hint, Button, MetricCard, NoteCard, SummaryCard, Timeline, fmtDur } from "../components/components";
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
  const live = running && ui;
  const bars = ui?.bars;
  const hist = ui?.history;

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
              disabled={running}
              onClick={() => onDurationChange(v)}
            >
              {durationLabel(v)}
            </button>
          ))}
        </div>
        <div className="session-clock">
          <span className="timer-label">{t.time}</span>
          <span className="timer-val num">{fmtDur(live ? ui!.elapsed_sec : 0)}</span>
        </div>
      </div>

      {/* metrics — always present; neutral until live. Each card carries a
          small corner tooltip explaining what it measures. */}
      <div className="metrics metrics-4">
        <MetricCard
          label={t.cpu}
          icon={<Cpu size={14} />}
          value={live ? bars!.cpu : null}
          history={live ? hist!.cpu : null}
          hint={t.cpuHint}
        />
        <MetricCard
          label={t.ram}
          icon={<Activity size={14} />}
          value={live ? bars!.ram : null}
          history={live ? hist!.ram : null}
          hint={t.ramHint}
        />
        <MetricCard
          label={t.gpu}
          icon={<Gauge size={14} />}
          value={live ? bars!.gpu : null}
          history={live && bars!.gpu !== null ? hist!.gpu : null}
          hint={t.gpuHint}
        />
        <MetricCard
          label={t.disk}
          icon={<HardDrive size={14} />}
          value={live ? bars!.disk : null}
          history={live ? hist!.disk : null}
          hint={t.diskHint}
        />
      </div>

      {/* timeline — always present */}
      {live ? (
        <>
          <Timeline
            elapsedSec={ui!.elapsed_sec}
            autoStopSec={ui!.auto_stop_sec}
            spikes={ui!.spikes.map((s) => ({ offsetMs: s.offset_ms, kind: s.kind }))}
            hasData={ui!.samples_count > 0}
            kindLabel={(k) => t.feed[k] ?? k}
            headLabel={ui!.auto_stop_sec ? t.timelineAutoStop : t.timelineDuration}
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
        />
      )}

      {/* limited-mode note: PowerShell unavailable — scans still work, some
          checks run on safe defaults. Shown once per app run (not per tick). */}
      {psLimited ? (
        <div className="bg-note" role="note">
          <strong>{t.psLimitedTitle}:</strong> {t.psLimitedBody}
        </div>
      ) : null}

      {/* activity feed — the flexible bottom block */}
      <section className="feed">
        <h3 className="feed-title">
          {t.activity}
          <Hint text={t.activityHint} />
        </h3>
        {live && ui!.feed.length > 0 ? (
          <ul className="feed-list">
            {ui!.feed.map((f, i) => (
              // stable composite key: the feed re-renders every live tick and
              // index keys would make React reuse the wrong rows after a shift
              <li key={`${f.clock}-${f.kind}-${i}`} className={`feed-item feed-${f.sev}`}>
                <span className="feed-clock num">{f.clock}</span>
                <span className="feed-text">{t.feed[f.kind] ?? f.kind}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="feed-empty">
            {live ? (ui!.game_running ? t.nothingUnusual : t.waitingGameloopFeed) : ""}
          </div>
        )}
      </section>

      {/* confirmed diagnosis cards — only while the engine confirms them */}
      {live && ui!.diagnoses.length > 0 ? (
        <div className="notes">
          {ui!.diagnoses.map((d) => {
            const copy = t.diagnoses[d.key] ?? { title: d.title, simple: d.simple, fix: d.fix };
            return (
              <NoteCard
                key={d.key}
                title={copy.title}
                simple={copy.simple}
                fix={copy.fix}
                severity={d.severity}
                fixLabel={t.fixLabel}
              />
            );
          })}
        </div>
      ) : null}

      {/* after finish — its own session's summary, never the dismissed one */}
      {summaryAllowed ? (
        <div className="summary-wrap">
          <SummaryCard
            title={ui!.lag_count > 0 ? t.spikesCaptured(ui!.lag_count) : t.sessionClean}
            hint={t.summaryHint(ui!.samples_count)}
            reportLabel={t.openReportBtn}
            dismissLabel={t.dialog.cancel}
            onReport={onOpenReport}
            onDismiss={() => onDismissSummary(sessionId!)}
          />
        </div>
      ) : null}
    </div>
  );
}
