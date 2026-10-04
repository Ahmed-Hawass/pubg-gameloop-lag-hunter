// components.tsx — design system building blocks, monochrome + signal green.
// Every screen is assembled ONLY from these. No placeholders — data-driven only.
// ALL icons come from lucide-react — zero hand-drawn SVGs anywhere.

import { useEffect, useState, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Cpu, Database, FileText, Gauge, Image, Info, Layers, Lightbulb, MemoryStick, Thermometer, X, Zap } from "lucide-react";
import type { CardSeverity } from "../bridge";

/** one fitting glyph per diagnosis key (verified in the engine's key
    set): unknown or future keys fall back to the severity triangle,
    never a blank title. */
export function diagnosisIcon(key: string): ReactNode {
  switch (key) {
    case "disk_wait":
      return <Database size={18} aria-hidden="true" />;
    case "cpu_busy":
      return <Cpu size={18} aria-hidden="true" />;
    case "cpu_throttle":
      return <Thermometer size={18} aria-hidden="true" />;
    case "mem_low":
      return <MemoryStick size={18} aria-hidden="true" />;
    case "paging_churn":
      return <Layers size={18} aria-hidden="true" />;
    case "gpu_wake":
      return <Zap size={18} aria-hidden="true" />;
    case "scene_hitch":
      return <Image size={18} aria-hidden="true" />;
    case "gpu_busy":
      return <Gauge size={18} aria-hidden="true" />;
    default:
      return <AlertTriangle size={18} aria-hidden="true" />;
  }
}

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
  /** extra classes for spot styling (e.g. per-button hover accents) */
  className?: string;
}) {
  const { label, icon, onClick, variant = "primary", size = "md", disabled, className } = props;
  const cls = [
    "btn",
    `btn-${variant}`,
    `btn-${size}`,
    disabled ? "is-disabled" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} onClick={onClick} disabled={disabled}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// MetricCard — centered tile (icon, value, label) with a corner "?"
// tooltip explaining what this metric measures.
// ---------------------------------------------------------------------------
export function MetricCard(props: {
  label: string;
  icon: ReactNode;
  value: number | null;
  /** what this metric measures — shown as a corner tooltip */
  hint?: string;
}) {
  const { label, icon, value, hint } = props;
  const dim = value === null;
  const v = value ?? 0;
  const tone = v >= 85 ? "danger" : v >= 60 ? "warn" : "ok";
  return (
    <div className={`card metric ${dim ? "dim" : ""}`}>
      {hint ? <MetricHint text={hint} /> : null}
      <div className={`metric-ico metric-ico-${dim ? "off" : tone}`}>{icon}</div>
      <div className="metric-val num">{dim ? "--" : `${v}%`}</div>
      <div className="metric-name">{label}</div>
    </div>
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
  /** translates machine event kinds (e.g. "disk_queue") for spike tooltips;
   *  falls back to the raw key when the locale lacks it */
  kindLabel: (kind: string) => string;
  /** the head label for the auto-stop target ("Auto-stop" / "Session duration") */
  headLabel: string;
  /** elapsed/target readout ("00:46 / 05:00"); null hides the target side */
  targetSec: number | null;
}) {
  const { elapsedSec, autoStopSec, spikes, hasData, kindLabel, headLabel, targetSec } = props;
  const total = autoStopSec ?? Math.max(elapsedSec, 60);
  const pct = Math.min(100, (elapsedSec / Math.max(total, 1)) * 100);
  return (
    <div className="timeline">
      {/* the whole timeline is LTR by design: it plots CLOCK TIME left-to-right
          (numbers are LTR even in RTL locales); pinning it avoids the marker
          drifting against the reading direction in Arabic */}
      <div className="timeline-head" dir="ltr">
        <span>{headLabel}</span>
        <span className="num">
          {fmtDur(elapsedSec)}
          {targetSec != null ? ` / ${fmtDur(targetSec)}` : ""}
        </span>
      </div>
      <div className="timeline-track" dir="ltr">
        {autoStopSec ? <div className="timeline-fill" style={{ width: `${pct}%` }} /> : null}
        {hasData
          ? spikes.map((s, i) => (
              <Tip key={i} text={kindLabel(s.kind)}>
                <span
                  className="tl-marker"
                  style={{
                    left: `${Math.min(100, (s.offsetMs / 1000 / Math.max(total, 1)) * 100)}%`,
                  }}
                />
              </Tip>
            ))
          : null}
      </div>
    </div>
  );
}

/** mm:ss clock format — the ONE duration formatter for the live session
 *  (Report rows use their own "Xm Ys" shape in ReportsView). */
export function fmtDur(sec: number) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// ---------------------------------------------------------------------------
// NoteCard — one diagnosis: title / explanation / fix in a solid
// highlighter fill (severity icon + card ink; the fix rides a white
// inset box). Used by the monitor diagnoses and the report findings.
// ---------------------------------------------------------------------------
export function NoteCard(props: {
  title: string;
  simple: string;
  fix: string;
  /** card severity ("high" | "medium" | "low") — drives the fill + icon */
  severity: CardSeverity;
  /** localized "Fix:" prefix for the fix block (e.g. "الحل:") */
  fixLabel?: string;
  /** title glyph (the caller maps its diagnosis key; severity triangle
      when omitted) */
  icon?: ReactNode;
}) {
  const { title, simple, fix, severity, fixLabel, icon } = props;
  return (
    <div className={`card-sm note note-${severity}`}>
      <div className="note-title">
        {icon ?? (severity === "low" ? null : <AlertTriangle size={16} aria-hidden="true" />)}
        {title}
      </div>
      <div className="note-body">{simple}</div>
      <div className="note-fix-box">
        <Lightbulb size={14} aria-hidden="true" />
        <span className="note-fix-label">{fixLabel ?? "Fix"}</span>
        {fix}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState — friendly nothing-yet (data-driven, never fake). The
// loading moment reuses the same panel with a spinning glyph
// (spin=true): one specimen everywhere, titles stay per-tab copy.
// ---------------------------------------------------------------------------
export function EmptyState(props: { icon: ReactNode; title: string; hint: string; spin?: boolean }) {
  const { icon, title, hint, spin } = props;
  return (
    <div className="empty">
      <div className={`empty-ico${spin ? " spin" : ""}`}>{icon}</div>
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
    <div className="card summary">
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
// IntroCard — one-shot page guidance for new users: what lives on this
// page and what to do first (never option mechanics: those stay behind
// each row's (?) button). Dumb surface, parents own the once-ever
// gating. Info fill, never a severity tone; the X reuses the summary
// dismiss language with its own accessible name (Tip is visual-only).
// ---------------------------------------------------------------------------
export function IntroCard(props: {
  icon: ReactNode;
  title: string;
  body: string;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  const { icon, title, body, dismissLabel, onDismiss } = props;
  return (
    <div className="card-sm intro-card">
      <span className="icon-tile intro-ico">{icon}</span>
      <div className="intro-text">
        <span className="intro-title">{title}</span>
        <p>{body}</p>
      </div>
      <Tip text={dismissLabel}>
        <button
          type="button"
          className="summary-x intro-x"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <X size={14} />
        </button>
      </Tip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog — the one VISIBLE modal surface for anything that needs the
// user's eyes: errors, confirmations, notices. (Structurally there are
// two roots — this plus UpdateModal's own overlay with its own trap —
// kept to one visible surface by yielding: only one ever shows.)
// Replaces every toast system. Native-window feel: centered, dimmed
// backdrop, Escape to dismiss, click-outside for notices.
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

  // focus trap: a keyboard user must never Tab out of a modal into the
  // dead page behind it. Tab cycles between the dialog's own buttons; the
  // initial focus stays on the first button (autoFocus below).
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const box = boxRef.current;
        if (!box) return;
        const focusables = box.querySelectorAll<HTMLElement>("button:not([disabled])");
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
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
        ref={boxRef}
        className="dialog-box"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="dialog-title">{title}</h3>
        <p className="dialog-body">{body}</p>
        <div className="dialog-actions">
          {kind === "confirm" ? (
            <>
              {/* focus STARTS on the destructive choice's CANCEL: with no
                  autofocus, focus stayed on the trigger BEHIND the modal
                  (a WAI-ARIA violation) and Enter re-fired the delete
                  button through the overlay. Safe side + keyboard-first. */}
              <button className="btn btn-md btn-ghost" onClick={onClose} autoFocus>
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
// useAnchoredTooltip — the ONE tooltip-positioning brain. Tip / MetricHint /
// Hint all render through it: the same estimated-width clamp, the same
// bottom-anchored portal. A positioning fix lands everywhere at once.
// ---------------------------------------------------------------------------
/**
 * Global signal: App dispatches it whenever the single modal surface opens
 * (dialog or update modal). A dialog mounting under a parked cursor
 * never fires mouseleave — without this the bubble stuck above the modal
 * (and stayed after it closed) until the user hovered the trigger again.
 */
export const MODAL_OPEN_EVENT = "laghunter:modal-open";

/**
 * Global signal for VIEW-LEVEL dialogs: App dispatches it when ITS dialog
 * (the dialog surface) opens on top of a view's own confirm/notice dialog.
 * The view dialog yields (closes itself) instead of stacking two overlays
 * where one Escape keydown would close both. Deliberately a SEPARATE event
 * from MODAL_OPEN_EVENT: a view dispatches that one for its OWN dialog,
 * and listening to it here would close the view's dialog on its own open.
 */
export const APP_DIALOG_OPEN_EVENT = "laghunter:app-dialog-open";

function useAnchoredTooltip(ref: React.RefObject<HTMLElement | null>, text: string) {
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);

  const show = () => {
    if (!text) return; // empty tip = no tooltip (expanded sidebar labels)
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // estimate width to clamp inside the window (max 280, small margin)
    const estW = Math.min(280, text.length * 6.5 + 28);
    let left = r.left + r.width / 2 - estW / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - estW - 12));
    // bottom-anchored: the tooltip's bottom edge sits 8px above the element
    setAnchor({ left, bottom: window.innerHeight - r.top + 8 });
  };
  const hide = () => setAnchor(null);

  // belt-and-suspenders: mouseleave/blur alone stick the bubble whenever a
  // hover ends WITHOUT pointer movement — a modal mounting under a parked
  // cursor, the window losing focus (Alt+Tab), or wheel-scroll detaching
  // the trigger. Each of these means "no longer hovering", so all hide.
  // (Press hides too — native tooltips vanish on press as well.)
  useEffect(() => {
    const hideAll = () => setAnchor(null);
    window.addEventListener("blur", hideAll);
    document.addEventListener("scroll", hideAll, true); // capture: any scroller
    document.addEventListener("pointerdown", hideAll, true); // capture: before click handlers
    window.addEventListener(MODAL_OPEN_EVENT, hideAll);
    return () => {
      window.removeEventListener("blur", hideAll);
      document.removeEventListener("scroll", hideAll, true);
      document.removeEventListener("pointerdown", hideAll, true);
      window.removeEventListener(MODAL_OPEN_EVENT, hideAll);
    };
  }, []);

  return { anchor, show, hide };
}

/** The portaled tooltip bubble every anchored tooltip renders. */
function TooltipBubble(props: { text: string; anchor: { left: number; bottom: number } }) {
  const { text, anchor } = props;
  return createPortal(
    <span className="hint-tooltip" role="tooltip" style={{ left: anchor.left, bottom: anchor.bottom }}>
      {text}
    </span>,
    document.body
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
  const { anchor, show, hide } = useAnchoredTooltip(ref, text);

  return (
    <span
      ref={ref}
      className="tip-wrap"
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={hide}
      onBlur={hide}
    >
      {children}
      {anchor ? <TooltipBubble text={text} anchor={anchor} /> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// MetricHint — the tiny corner tooltip inside MetricCard: the SAME Info icon
// as the Hint button everywhere else (one hint glyph across the app), opening
// the same portaled tooltip. Rendered by MetricCard (hint text), not callers.
// ---------------------------------------------------------------------------
function MetricHint(props: { text: string }) {
  const { text } = props;
  const ref = useRef<HTMLSpanElement>(null);
  const { anchor, show, hide } = useAnchoredTooltip(ref, text);

  return (
    <span
      ref={ref}
      className="metric-hint-dot"
      // a focusable span with an icon needs a name: the tooltip text
      // paints on hover only, screen readers would announce nothing
      role="button"
      tabIndex={0}
      aria-label={text}
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={hide}
      onBlur={hide}
    >
      <Info size={12} />
      {anchor ? <TooltipBubble text={text} anchor={anchor} /> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hint — a real button with a custom tooltip, portaled to the page root so
// NO ancestor (overflow, transform, z-index) can ever clip or hide it.
// No OS/browser tooltips, no help-cursor question mark — ours looks native.
// ---------------------------------------------------------------------------
export function Hint(props: { text: string }) {
  const { text } = props;
  const ref = useRef<HTMLButtonElement>(null);
  const { anchor, show, hide } = useAnchoredTooltip(ref, text);

  return (
    <button
      type="button"
      ref={ref}
      className="hint"
      aria-label={text}
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={hide}
      onBlur={hide}
    >
      <Info size={13} />
      {anchor ? <TooltipBubble text={text} anchor={anchor} /> : null}
    </button>
  );
}


