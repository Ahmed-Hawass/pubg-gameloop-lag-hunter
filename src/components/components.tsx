// components.tsx — design system building blocks, monochrome + signal green.
// Every screen is assembled ONLY from these. No placeholders — data-driven only.
// ALL icons come from lucide-react — zero hand-drawn SVGs anywhere.

import { useEffect, useId, useState, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Cpu, Database, Gauge, Image, Info, Layers, Lightbulb, MemoryStick, Thermometer, X, Zap } from "lucide-react";
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
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {icon}
      <span>{label}</span>
    </button>
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
  fixLabel: string;
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
        <span className="note-fix-label">{fixLabel}</span>
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
// IntroCard — one-shot page guidance for new users: what lives on this
// page and what to do first (never option mechanics: those stay behind
// each row's (?) button). Dumb surface, parents own the once-ever
// gating. Info fill, never a severity tone; the X owns its own
// accessible name (Tip is visual-only).
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
          className="card-x intro-x"
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
export function Dialog(
  props: {
    title: string;
    body: string;
    danger?: boolean;
    onConfirm?: () => void;
    onClose: () => void;
  } & (
    | { kind: "notice"; okLabel: string }
    | { kind: "confirm"; confirmLabel: string; cancelLabel: string }
  ),
) {
  const { title, body, kind, danger, onConfirm, onClose } = props;
  const okLabel = props.kind === "notice" ? props.okLabel : "";
  const confirmLabel = props.kind === "confirm" ? props.confirmLabel : "";
  const cancelLabel = props.kind === "confirm" ? props.cancelLabel : "";
  const titleId = useId();
  const bodyId = useId();

  // focus trap: a keyboard user must never Tab out of a modal into the
  // dead page behind it. Tab cycles between the dialog's own focusables;
  // the initial focus stays on the first button (autoFocus below).
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const box = boxRef.current;
        if (!box) return;
        const focusables = box.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
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
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="dialog-title" id={titleId}>{title}</h3>
        <p className="dialog-body" id={bodyId}>{body}</p>
        <div className="dialog-actions">
          {kind === "confirm" ? (
            <>
              {/* focus STARTS on the destructive choice's CANCEL: with no
                  autofocus, focus stayed on the trigger BEHIND the modal
                  (a WAI-ARIA violation) and Enter re-fired the delete
                  button through the overlay. Safe side + keyboard-first. */}
              <button className="btn btn-md btn-ghost" onClick={onClose} autoFocus>
                {cancelLabel}
              </button>
              <button
                className={`btn btn-md ${danger ? "btn-danger-filled" : "btn-primary"}`}
                onClick={() => {
                  onConfirm?.();
                  onClose();
                }}
              >
                {confirmLabel}
              </button>
            </>
          ) : (
            <button
              className="btn btn-md btn-primary"
              onClick={onClose}
              autoFocus
            >
              {okLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// useAnchoredTooltip — the ONE tooltip-positioning brain. Tip /
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

/** typed dispatchers: call these instead of constructing Events by hand,
    so a renamed signal breaks the build instead of going silent */
export function dispatchModalOpen(): void {
  window.dispatchEvent(new Event(MODAL_OPEN_EVENT));
}

export function dispatchAppDialogOpen(): void {
  window.dispatchEvent(new Event(APP_DIALOG_OPEN_EVENT));
}

function useAnchoredTooltip(ref: React.RefObject<HTMLElement | null>, text: string) {
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const rectRef = useRef<DOMRect | null>(null);

  const place = (w: number) => {
    const r = rectRef.current;
    if (!r || !(w > 0)) return;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
    const bottom = window.innerHeight - r.top + 8;
    setAnchor((prev) =>
      prev !== null && Math.abs(prev.left - left) < 1 && prev.bottom === bottom
        ? prev
        : { left, bottom },
    );
  };

  const show = () => {
    if (!text) return; // empty tip = no tooltip (expanded sidebar labels)
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    rectRef.current = r;
    // first paint uses an estimate so the bubble never flashes at 0,0;
    // the mounted bubble then reports its real width and re-centers.
    // JSDOM reports offsetWidth 0, so the estimate stands in tests.
    const estW = Math.min(280, text.length * 6.5 + 28);
    place(estW);
  };
  const hide = () => {
    rectRef.current = null;
    setAnchor(null);
  };
  /** re-center once the mounted bubble reports its real width */
  const adjust = (w: number) => place(w);

  // invalidate on text change: the sidebar flips text between a label and
  // "" on collapse/expand, so a stale anchor would render an orphan bubble
  // (empty after expand, wrong label/position after collapse) or stick
  // after the trigger moved.
  useEffect(() => {
    rectRef.current = null;
    setAnchor(null);
  }, [text]);

  // belt-and-suspenders: mouseleave/blur alone stick the bubble whenever a
  // hover ends WITHOUT pointer movement — a modal mounting under a parked
  // cursor, the window losing focus (Alt+Tab), or wheel-scroll detaching
  // the trigger. Each of these means "no longer hovering", so all hide.
  // (Press hides too — native tooltips vanish on press as well.)
  useEffect(() => {
    const hideAll = () => setAnchor(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hideAll();
    };
    window.addEventListener("blur", hideAll);
    window.addEventListener("resize", hideAll);
    document.addEventListener("scroll", hideAll, true); // capture: any scroller
    document.addEventListener("pointerdown", hideAll, true); // capture: before click handlers
    document.addEventListener("pointercancel", hideAll, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener(MODAL_OPEN_EVENT, hideAll);
    return () => {
      window.removeEventListener("blur", hideAll);
      window.removeEventListener("resize", hideAll);
      document.removeEventListener("scroll", hideAll, true);
      document.removeEventListener("pointerdown", hideAll, true);
      document.removeEventListener("pointercancel", hideAll, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener(MODAL_OPEN_EVENT, hideAll);
    };
  }, []);

  return { anchor, show, hide, adjust };
}

/** The portaled tooltip bubble every anchored tooltip renders. */
function TooltipBubble(props: {
  text: string;
  anchor: { left: number; bottom: number };
  id?: string;
  onMeasured?: (w: number) => void;
}) {
  const { text, anchor, id, onMeasured } = props;
  const spanRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const w = spanRef.current?.offsetWidth ?? 0;
    if (w > 0) onMeasured?.(w);
    // measure once per mount: the text never changes under an open bubble
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <span
      ref={spanRef}
      className="hint-tooltip"
      role="tooltip"
      id={id}
      // Documented exception to the logical-property rule: `left` here is
      // a viewport coordinate from getBoundingClientRect (already mirrored
      // by the browser in RTL), not a layout side, so inset-inline-start
      // would place it wrong.
      style={{ left: anchor.left, bottom: anchor.bottom }}
    >
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
  const { anchor, show, hide, adjust } = useAnchoredTooltip(ref, text);
  const tipId = useId();

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
      {anchor && text ? (
        <TooltipBubble text={text} anchor={anchor} id={tipId} onMeasured={adjust} />
      ) : null}
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
  const { anchor, show, hide, adjust } = useAnchoredTooltip(ref, text);
  const tipId = useId();

  return (
    <button
      type="button"
      ref={ref}
      className="hint"
      aria-label={text}
      aria-describedby={anchor ? tipId : undefined}
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={hide}
      onBlur={hide}
    >
      <Info size={13} aria-hidden="true" />
      {anchor ? <TooltipBubble text={text} anchor={anchor} id={tipId} onMeasured={adjust} /> : null}
    </button>
  );
}


