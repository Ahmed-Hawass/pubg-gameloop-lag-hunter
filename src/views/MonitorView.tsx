// MonitorView.tsx — three states, one per phase of a scan. The user's
// relationship to each is different, so the page answers a different
// question in each:
//
//   idle    the user is here and deciding: how long, and go
//   running the user is AWAY and playing: one line, a clock, a stop button
//   result  the user came back: the verdict, in two seconds of reading
//
// Nothing here renders a live instrument panel. The tiles measured the
// whole machine, not the game, so they sat red during normal play and
// taught the user to ignore red. The verdict is the only thing that
// answers "was there lag".

import { Check, CircleAlert, FileText, Play, RefreshCw, Square } from "lucide-react";
import { Button, fmtDur } from "../components/components";
import type { StatusPayload } from "../bridge";
import { useLang } from "../i18n";

export function MonitorView(props: {
  status: StatusPayload;
  busy: boolean;
  durationSecs: number;
  onDurationChange: (v: number) => void;
  onToggle: () => void;
  onOpenReport: () => void;
  /** the session whose summary was dismissed (never show it again) */
  dismissedSession: string | null;
  onDismissSummary: (session: string) => void;
  /** PowerShell unavailable on this machine — limited mode */
  psLimited: boolean;
}) {
  const { status, busy, durationSecs, onDurationChange, onToggle, onOpenReport, dismissedSession, onDismissSummary, psLimited } = props;
  const { t } = useLang();
  const ui = status.ui;
  const running = status.status === "running";
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

  // The result state never auto-dismisses. It used to fade after 12s, which
  // was right while the user stood watching the scan, and wrong here: a user
  // returning from a half-hour session found an empty page. It now waits for
  // an action (open the report, or start another scan).
  const resultAllowed =
    status.status === "finished" &&
    ui != null &&
    ui.samples_count > 0 &&
    sessionId !== null &&
    sessionId !== dismissedSession;

  return (
    <div className="monitor">
      {psLimited && !running ? (
        <div className="bg-note" role="note">
          <strong>{t.psLimitedTitle}:</strong> {t.psLimitedBody}
        </div>
      ) : null}

      {resultAllowed ? (
        <ResultState
          lagCount={ui!.lag_count}
          samplesCount={ui!.samples_count}
          momentCount={ui!.diagnoses.length || ui!.spikes.length}
          topSignal={ui!.diagnoses[0]?.key ?? null}
          minutes={Math.round((ui!.elapsed_sec || durationSecs) / 60)}
          onOpenReport={onOpenReport}
          onDismiss={() => onDismissSummary(sessionId!)}
        />
      ) : running ? (
        <RunningState
          elapsedSec={ui?.elapsed_sec ?? 0}
          autoStopSec={ui?.auto_stop_sec ?? durationSecs}
          samplesCount={ui?.samples_count ?? 0}
          momentCount={ui?.diagnoses.length || ui?.spikes.length || 0}
          onStop={onToggle}
        />
      ) : (
        <IdleState
          busy={busy}
          status={status.status}
          durationSecs={durationSecs}
          durationLabel={durationLabel}
          onDurationChange={onDurationChange}
          onToggle={onToggle}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// idle — one centered column: the session plan. The number leads, the pills
// sit under the number they control, the 3-step path teaches the flow, the
// button is the decision, and one tip row closes as a quiet footnote.
// ---------------------------------------------------------------------------
function IdleState(props: {
  busy: boolean;
  status: StatusPayload["status"];
  durationSecs: number;
  durationLabel: (secs: number) => string;
  onDurationChange: (v: number) => void;
  onToggle: () => void;
}) {
  const { busy, status, durationSecs, durationLabel, onDurationChange, onToggle } = props;
  const { t } = useLang();
  const minutes = Math.max(1, Math.round(durationSecs / 60));
  return (
    <div className="idle-state">
      <div className="idle-main">
        <div className="plan-kicker">{t.scanPlanKicker}</div>
        <div className="plan-big">
          <span className="num">{minutes}</span>
          <span className="plan-unit">{t.scanPlanUnit(minutes)}</span>
        </div>
        <div className="scan-duration plan-seg" role="radiogroup" aria-label={t.autoStop}>
          {[300, 600, 1800, 3600].map((v) => (
            <button
              key={v}
              className={`focus-ring-inset scan-dur-btn ${durationSecs === v ? "is-active" : ""}`}
              role="radio"
              aria-checked={durationSecs === v}
              onClick={() => onDurationChange(v)}
            >
              {durationLabel(v)}
            </button>
          ))}
        </div>
        <div className="plan-steps">
          <div className="step"><span className="disc" aria-hidden="true">1</span><span>{t.scanStep1}</span></div>
          <div className="step"><span className="disc" aria-hidden="true">2</span><span>{t.scanStep2}</span></div>
          <div className="step"><span className="disc" aria-hidden="true">3</span><span>{t.scanStep3}</span></div>
        </div>
        {/* the hero action rides the shared .btn materials (hover nudge,
            press shrink, keyboard focus ring) with hero sizing on top */}
        <button
          type="button"
          className={`focus-ring btn btn-primary btn-hero ${busy || status === "stopping" ? "is-disabled" : ""}`}
          disabled={busy || status === "stopping"}
          onClick={onToggle}
        >
          {/* lucide Play, filled: the whole app speaks lucide, so the hero
              glyph does too — no bespoke SVG to maintain. fill rides the
              button ink in both themes, stroke off. */}
          <Play size={20} fill="currentColor" stroke="none" aria-hidden="true" />
          <span>{t.scanIdleStart}</span>
        </button>
        <div className="plan-tips">
          <div className="tip-row">
            <span className="tip-disc" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
            <span>{t.scanIdleCloseApps}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// running — the user is away. This screen's job is to send them back to the
// game, not to entertain them: a clock they care about, an honest count, and
// the one button that means something right now.
// ---------------------------------------------------------------------------
function RunningState(props: {
  elapsedSec: number;
  autoStopSec: number;
  samplesCount: number;
  momentCount: number;
  onStop: () => void;
}) {
  const { elapsedSec, autoStopSec, samplesCount, momentCount, onStop } = props;
  const { t } = useLang();
  const remainingSec = Math.max(0, autoStopSec - elapsedSec);
  const pct = autoStopSec > 0 ? Math.min(100, Math.round((elapsedSec / autoStopSec) * 100)) : 0;
  return (
    <div className="run-state">
      {/* the radar: dashed rings + a conic sweep arm. Everything animated is
          transform or opacity (compositor-only), so this costs nothing on a
          machine that is busy running a game */}
      <div className="run-radar" aria-hidden="true">
        <span className="run-ring run-ring-1" />
        <span className="run-ring run-ring-2" />
        <span className="run-ring run-ring-3" />
        <span className="run-sweep" />
        <span className="run-pip run-pip-1" />
        <span className="run-pip run-pip-2" />
        <span className="run-pip run-pip-3" />
        <div className="run-radar-core">
          <span className="run-pct num">{pct}%</span>
          <span className="run-core-k">{t.scanOfSession}</span>
        </div>
      </div>

      <div className="run-msg">
        <h2>{t.scanRunningTitle}</h2>
        <p>{t.scanRunningBody}</p>
      </div>
      {/* the live question this screen answers: "can I minimize this?"
          It lives here, not in idle, because this is where the window is
          actually open and the doubt is real — idle can only promise it
          in theory. */}
      <p className="run-note">{t.scanRunningNote}</p>

      {/* the three numbers the returning user actually wants, as one quiet
          strip — no side column competing with the message */}
      <div className="run-rail">
        <div>
          <div className="run-k">{t.scanElapsed}</div>
          <div className="run-v num">{fmtDur(elapsedSec)}</div>
        </div>
        <div>
          <div className="run-k">{t.scanRemainingLabel}</div>
          <div className="run-v">{t.scanRemaining(Math.ceil(remainingSec / 60))}</div>
        </div>
        <div>
          <div className="run-k">{t.scanSamples}</div>
          <div className="run-v num">{samplesCount}</div>
        </div>
      </div>

      {momentCount > 0 ? (
        <div className="run-moments" role="status">{t.scanMoments(momentCount)}</div>
      ) : null}

      {/* lucide Square, filled: the same fill-trick as the Play glyph —
          the whole app speaks lucide, so the stop mark does too. No
          bespoke SVG to maintain. */}
      <Button
        label={t.scanStop}
        icon={<Square size={16} fill="currentColor" stroke="none" aria-hidden="true" />}
        variant="danger-filled"
        size="lg"
        onClick={onStop}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// result — the verdict. The state fills the whole card, never just an icon
// edge (the rule commit 44bde31 set for every card in the app), and the
// state quads are identical in both themes so this needs no light rules.
// ---------------------------------------------------------------------------
function ResultState(props: {
  lagCount: number;
  samplesCount: number;
  momentCount: number;
  topSignal: string | null;
  minutes: number;
  onOpenReport: () => void;
  onDismiss: () => void;
}) {
  const { lagCount, samplesCount, momentCount, topSignal, minutes, onOpenReport, onDismiss } = props;
  const { t } = useLang();
  const lagged = lagCount > 0;
  // the top signal is an engine key; the locale dictionary is the same one
  // the report uses for key moments, with an honest fallback to the count
  const signalLabel = topSignal ? (t.diagnoses[topSignal]?.title ?? null) : null;
  return (
    <div className="result-state">
      <div className={`card verdict ${lagged ? "verdict-danger" : "verdict-success"}`}>
        <span className="verdict-ico" aria-hidden="true">
          {lagged ? <CircleAlert size={24} /> : <Check size={24} strokeWidth={2.4} />}
        </span>
        <div className="verdict-body">
          <div className="verdict-head">{lagged ? t.scanResultLagTitle : t.scanResultCleanTitle}</div>
          <div className="verdict-sub">{t.scanResultOver(minutes)}</div>
        </div>
        <div className="verdict-num">
          <span className="num">{lagCount}</span>
          <span className="verdict-unit">{t.scanResultSeconds}</span>
        </div>
      </div>

      <div className="result-strip">
        <div className="card-sm result-cell">
          <div className="result-k">{t.scanSamples}</div>
          <div className="result-v num">{samplesCount}</div>
        </div>
        <div className="card-sm result-cell">
          <div className="result-k">{t.scanResultMoments}</div>
          <div className="result-v num">{momentCount}</div>
        </div>
        <div className="card-sm result-cell">
          <div className="result-k">{t.scanResultTopSignal}</div>
          <div className="result-v result-v-long">{signalLabel ?? t.scanResultNone}</div>
        </div>
      </div>

      <div className="result-actions">
        <Button label={t.scanResultOpenReport} icon={<FileText size={15} />} variant="primary" size="lg" onClick={onOpenReport} />
        <Button label={t.scanResultAgain} icon={<RefreshCw size={15} />} variant="ghost" size="md" onClick={onDismiss} />
      </div>

      <p className="result-foot">{t.scanResultFootnote}</p>
    </div>
  );
}