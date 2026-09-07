// components.tsx — design system building blocks, monochrome + signal green.
// Every screen is assembled ONLY from these. No placeholders — data-driven only.
// ALL icons come from lucide-react — zero hand-drawn SVGs anywhere.

import { useEffect, useState, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, CircleHelp, FileText, Info, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Button — every action in the app
// ---------------------------------------------------------------------------
export function Button(props: {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "danger" | "danger-filled" | "ghost";
  size?: "md" | "lg";
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const { label, icon, onClick, variant = "primary", size = "md", disabled, style } = props;
  const cls = ["btn", `btn-${variant}`, `btn-${size}`, disabled ? "is-disabled" : ""].join(" ");
  return (
    <button className={cls} onClick={onClick} disabled={disabled} style={style}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// MetricCard — labeled meter with real sparkline from engine history.
// A small corner "?" tooltip explains what this metric means.
// ---------------------------------------------------------------------------
export function MetricCard(props: {
  label: string;
  icon: ReactNode;
  value: number | null;
  /** 0-100 history, newest last; null history = dim "no data" state */
  history: number[] | null;
  /** what this metric measures — shown as a corner tooltip */
  hint?: string;
}) {
  const { label, icon, value, history, hint } = props;
  const dim = value === null || history === null;
  const v = value ?? 0;
  const tone = v >= 85 ? "danger" : v >= 60 ? "warn" : "ok";
  return (
    <div className={`metric ${dim ? "dim" : ""}`}>
      <div className="metric-top">
        <div className={`metric-name metric-name-${dim ? "off" : tone}`}>
          {icon}
          {label}
        </div>
        <div className="metric-head-right">
          {hint ? <MetricHint text={hint} /> : null}
          <div className="metric-val num">{dim ? "--" : `${v}%`}</div>
        </div>
      </div>
      <div className="bar-track">
        <div className={`bar-fill bar-${tone}`} style={{ width: dim ? 0 : `${v}%` }} />
      </div>
      <Sparkline values={history} dim={dim} />
    </div>
  );
}

/** Sparkline drawn from real history — no fake data. */
function Sparkline(props: { values: number[] | null; dim: boolean }) {
  const { values, dim } = props;
  if (dim || !values || values.length < 2) {
    return (
      <svg className="spark" viewBox="0 0 100 22" preserveAspectRatio="none">
        <polyline points="0,11 100,11" fill="none" stroke="var(--text-3)" strokeWidth="1.4" strokeDasharray="3 4" />
      </svg>
    );
  }
  const w = 100;
  const h = 22;
  const step = w / (values.length - 1);
  const y = (v: number) => h - 2 - (v / 100) * (h - 4);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth="1.6" opacity="0.85" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Timeline — session progress + real spike markers from engine events
// ---------------------------------------------------------------------------
export interface SpikeMarkView {
  offsetMs: number;
  kind: string;
}

export function Timeline(props: {
  elapsedSec: number;
  autoStopSec: number | null;
  spikes: SpikeMarkView[];
  hasData: boolean;
}) {
  const { elapsedSec, autoStopSec, spikes, hasData } = props;
  const total = autoStopSec ?? Math.max(elapsedSec, 60);
  const pct = Math.min(100, (elapsedSec / Math.max(total, 1)) * 100);
  return (
    <div className="timeline">
      {/* the whole timeline is LTR by design: it plots CLOCK TIME left-to-right
          (numbers are LTR even in RTL locales); pinning it avoids the marker
          drifting against the reading direction in Arabic */}
      <div className="timeline-head" dir="ltr">
        <span className="num">00:00</span>
        <span>{autoStopSec ? "Auto-stop" : "Session duration"}</span>
        <span className="num">{fmtDur(elapsedSec)}</span>
      </div>
      <div className="timeline-track" dir="ltr">
        {autoStopSec ? <div className="timeline-fill" style={{ width: `${pct}%` }} /> : null}
        {hasData
          ? spikes.map((s, i) => (
              <Tip key={i} text={s.kind}>
                <span
                  className="tl-marker"
                  style={{ left: `${(s.offsetMs / 1000 / Math.max(total, 1)) * 100}%` }}
                />
              </Tip>
            ))
          : null}
      </div>
    </div>
  );
}

function fmtDur(sec: number) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// ---------------------------------------------------------------------------
// NoteCard — one diagnosis: title / explanation / fix (sev-aware colors)
// ---------------------------------------------------------------------------
export function NoteCard(props: { title: string; simple: string; fix: string; severity: string }) {
  const { title, simple, fix, severity } = props;
  return (
    <div className={`note note-${severity}`}>
      <div className="note-title">
        <span className={`note-dot note-dot-${severity}`} />
        {title}
      </div>
      <div className="note-body">{simple}</div>
      <div className="note-fix">
        <span className="note-fix-label">Fix</span>
        {fix}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState — friendly nothing-yet (data-driven, never fake)
// ---------------------------------------------------------------------------
export function EmptyState(props: { icon: ReactNode; title: string; hint: string }) {
  const { icon, title, hint } = props;
  return (
    <div className="empty">
      <div className="empty-ico">{icon}</div>
      <div className="empty-title">{title}</div>
      <div className="empty-hint">{hint}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SummaryCard — post-session result: report button + instant dismiss (X)
// ---------------------------------------------------------------------------
export function SummaryCard(props: {
  title: string;
  hint: string;
  reportLabel: string;
  dismissLabel: string;
  onReport: () => void;
  onDismiss: () => void;
}) {
  const { title, hint, reportLabel, dismissLabel, onReport, onDismiss } = props;
  return (
    <div className="summary">
      <div className="summary-ico">
        <Check size={18} strokeWidth={2.2} />
      </div>
      <div className="summary-text">
        <h3>{title}</h3>
        <p>{hint}</p>
      </div>
      <Button label={reportLabel} icon={<FileText size={14} />} variant="ghost" onClick={onReport} />
      <Tip text={dismissLabel}>
        <button className="summary-x" onClick={onDismiss}>
          <X size={14} />
        </button>
      </Tip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog — the ONE modal surface for anything that needs the user's eyes:
// errors, confirmations, notices. Replaces every toast. Native-window feel:
// centered, dimmed backdrop, Escape to dismiss, click-outside for notices.
// ---------------------------------------------------------------------------
export function Dialog(props: {
  title: string;
  body: string;
  kind: "notice" | "confirm";
  okLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm?: () => void;
  onClose: () => void;
}) {
  const { title, body, kind, okLabel, confirmLabel, cancelLabel, danger, onConfirm, onClose } = props;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="dialog-overlay"
      onClick={() => {
        if (kind === "notice") onClose();
      }}
    >
      <div
        className={`dialog-box ${danger ? "dialog-danger" : ""}`}
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="dialog-title">{title}</h3>
        <p className="dialog-body">{body}</p>
        <div className="dialog-actions">
          {kind === "confirm" ? (
            <>
              <button className="btn btn-md btn-ghost" onClick={onClose}>
                {cancelLabel ?? "Cancel"}
              </button>
              <button
                className={`btn btn-md ${danger ? "btn-danger-filled" : "btn-primary"}`}
                onClick={() => {
                  onConfirm?.();
                  onClose();
                }}
              >
                {confirmLabel ?? "Confirm"}
              </button>
            </>
          ) : (
            <button
              className="btn btn-md btn-primary"
              onClick={onClose}
              autoFocus
            >
              {okLabel ?? "OK"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tip — wraps ANY element with the app's portaled tooltip. One tooltip
// system for the whole app: hover/focus shows a themed, un-clippable bubble.
// Usage: <Tip text="..."><button/></Tip>
// ---------------------------------------------------------------------------
export function Tip(props: { text: string; children: ReactNode }) {
  const { text, children } = props;
  const ref = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);

  const show = () => {
    if (!text) return; // empty tip = no tooltip (expanded sidebar labels)
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const estW = Math.min(280, text.length * 6.5 + 28);
    let left = r.left + r.width / 2 - estW / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - estW - 12));
    setAnchor({ left, bottom: window.innerHeight - r.top + 8 });
  };

  return (
    <span
      ref={ref}
      className="tip-wrap"
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={() => setAnchor(null)}
      onBlur={() => setAnchor(null)}
    >
      {children}
      {anchor
        ? createPortal(
            <span className="hint-tooltip" role="tooltip" style={{ left: anchor.left, bottom: anchor.bottom }}>
              {text}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// MetricHint — the tiny corner tooltip inside MetricCard: a small circled
// "?" that opens the same portaled tooltip as everywhere else. Rendered by
// MetricCard (hint text), not by callers.
// ---------------------------------------------------------------------------
function MetricHint(props: { text: string }) {
  const { text } = props;
  const ref = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);

  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const estW = Math.min(280, text.length * 6.5 + 28);
    let left = r.left + r.width / 2 - estW / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - estW - 12));
    setAnchor({ left, bottom: window.innerHeight - r.top + 8 });
  };

  return (
    <span
      ref={ref}
      className="metric-hint-dot"
      tabIndex={0}
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={() => setAnchor(null)}
      onBlur={() => setAnchor(null)}
    >
      <CircleHelp size={12} />
      {anchor
        ? createPortal(
            <span className="hint-tooltip" role="tooltip" style={{ left: anchor.left, bottom: anchor.bottom }}>
              {text}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hint — a real button with a custom tooltip, portaled to the page root so
// NO ancestor (overflow, transform, z-index) can ever clip or hide it.
// No OS/browser tooltips, no help-cursor question mark — ours looks native.
// ---------------------------------------------------------------------------
export function Hint(props: { text: string; children?: ReactNode }) {
  const { text, children } = props;
  const ref = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);

  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // estimate width to clamp inside the window (max 280, small margin)
    const estW = Math.min(280, text.length * 6.5 + 28);
    let left = r.left + r.width / 2 - estW / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - estW - 12));
    // bottom-anchored: the tooltip's bottom edge sits 8px above the button
    setAnchor({ left, bottom: window.innerHeight - r.top + 8 });
  };

  return (
    <button
      type="button"
      ref={ref}
      className="hint"
      aria-label={text}
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={() => setAnchor(null)}
      onBlur={() => setAnchor(null)}
    >
      {children ? <span className="hint-text">{children}</span> : null}
      <Info size={13} />
      {anchor
        ? createPortal(
            <span className="hint-tooltip" role="tooltip" style={{ left: anchor.left, bottom: anchor.bottom }}>
              {text}
            </span>,
            document.body
          )
        : null}
    </button>
  );
}


