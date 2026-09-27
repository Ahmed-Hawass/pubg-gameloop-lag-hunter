// SwitchRow.tsx — one Tools switch row. The switch mirrors the live RESULT
// of its named action (ON = the action holds right now). The label names
// the action itself ("Turn off X"), so ON is always the recommended state
// by construction. Row copy is the name alone; the definition lives
// behind the (?) button (same contract as the health cards).

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { useLang } from "../../i18n";

export function SwitchRow(props: {
  /** stable row id: deep-link target (data-tweak) + highlight match */
  tweakId: string;
  on: boolean;
  func: ReactNode;
  name: string;
  /** background note behind the (?) button: definition plus background
      (plain language, never invented numbers) */
  hintTitle: string;
  hintBody: string;
  onHint: (title: string, body: string) => void;
  /** visible effect timing under the name (one shared string, only
      where verified: immediate for power/DVR, reopen for GPU/FSO/
      windowed; rows without a verified timing show no line rather
      than a guessed one) */
  effect?: string;
  /** the health-card deep-link landed on this row: temporary ring */
  linked: boolean;
  busy: boolean;
  onFlip: (next: boolean) => void;
  /** greyed, non-clickable row with a translated reason underneath —
      for preconditions the user can fix (vs hidden, for rows that can
      never work here) */
  disabled?: boolean;
  disabledHint?: string;
}) {
  const { t } = useLang();
  const { tweakId, on, func, name, hintTitle, hintBody, onHint, linked, busy, onFlip, disabled, disabledHint, effect } = props;
  return (
    <div
      data-tweak={tweakId}
      className={`card-sm switch-row ${on ? "verdict-ok" : "verdict-warn"}${disabled ? " is-disabled" : ""}${linked ? " is-linked" : ""}`}
    >
      <span className="icon-tile check-func">{func}</span>
      <div className="switch-body">
        <span className="switch-name">
          {name}
          <button
            type="button"
            className="switch-hint"
            aria-label={hintTitle}
            onClick={() => onHint(hintTitle, hintBody)}
          >
            <Info size={13} />
          </button>
        </span>
        {effect ? <span className="switch-state">{effect}</span> : null}
        {disabled && disabledHint ? (
          <span className="switch-reason">{disabledHint}</span>
        ) : null}
      </div>
      <span className={`badge check-badge ${on ? "ok" : "warn"}`}>
        {on ? t.checkOkBadge : t.checkWarnBadge}
      </span>
      <button
        role="switch"
        aria-checked={on}
        aria-label={name}
        aria-disabled={disabled}
        className="switch"
        disabled={busy || disabled}
        onClick={() => void onFlip(!on)}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}
