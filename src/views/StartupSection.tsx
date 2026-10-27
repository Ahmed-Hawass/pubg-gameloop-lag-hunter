// StartupSection.tsx - startup programs: one switch row per program that
// launches at sign-in. The switch mirrors the live Windows state (ON =
// the overlay lets it run); flipping writes the overlay only, values are
// never deleted, so every change reverses. Reads are cheap in-process
// registry scans: mount, window-focus, and a slow backstop poll.
// Shaped like the Tools sections (PageIntro header plus optional back
// control) so a later move under Tools is a card plus a route, not a
// redesign - today it rides its own sidebar tab with no trail.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppWindow, CircleGauge, Shield } from "lucide-react";
import { Dialog, EmptyState } from "../components/components";
import { PageIntro } from "../components/sections";
import { useIntervalTick, BACKSTOP_POLL_MS } from "../useIntervalTick";
import { api, type StartupEntry } from "../bridge";
import { errorDialog, toErrorBody, type Notice } from "../errors";
import { useLang } from "../i18n";
import { useModalSignal, useYieldToAppDialog } from "./tools/useModalSignals";

export function StartupSection(props: {
  active: boolean;
  /** back control from the shell, rendered at the header row end
      (Tools move only - the standalone tab passes none) */
  headerTrail?: ReactNode;
}) {
  const { active, headerTrail } = props;
  const { t } = useLang();
  const [entries, setEntries] = useState<StartupEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flippingId, setFlippingId] = useState<string | null>(null);
  /** enable confirm target (null = no confirm): turning on names the
      program and its cost first (the additive direction: slower
      startup), while turning off stays direct. confirmAdmin rides
      along: a locked row turned on still names the program before the
      system prompt appears */
  const [confirmOn, setConfirmOn] = useState<StartupEntry | null>(null);
  const [confirmAdmin, setConfirmAdmin] = useState(false);
  /** action failure notice on the one modal surface */
  const [notice, setNotice] = useState<Notice | null>(null);
  const busyRef = useRef(false);
  /** the focus listener outlives renders: read the live tab visibility
      from a ref so a hidden tab never re-scans on window focus */
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const closeConfirm = () => {
    setConfirmOn(null);
    setConfirmAdmin(false);
  };
  const closeNotice = () => setNotice(null);
  useYieldToAppDialog(confirmOn !== null, closeConfirm);
  useYieldToAppDialog(notice !== null, closeNotice);
  useModalSignal(confirmOn !== null || notice !== null);

  const load = async (silent: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      setEntries(await api.startupEntries());
      setError(null);
    } catch (e) {
      if (!silent) {
        setError(toErrorBody(e, t));
      }
    } finally {
      busyRef.current = false;
    }
  };

  // first data + window-focus re-read (a flip in Settings or Task Manager
  // lands here: Windows is the truth, this page only mirrors it). The
  // listener checks the live tab visibility: all views stay mounted, so an
  // unfocused hidden tab must not run a registry scan on every focus.
  useEffect(() => {
    void load(false);
    const onFocus = () => {
      if (activeRef.current) void load(true);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // mount-once bootstrap like every polling view: load's identity is
    // not part of the subscription contract
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // slow backstop poll while visible (same contract as the Tools pages)
  useIntervalTick(active, BACKSTOP_POLL_MS, () => void load(true));

  const failNotice = (e: unknown) => {
    const raw = typeof e === "string" ? e : String(e);
    // a dismissed system prompt is a choice, not a failure (the same
    // exact-"cancelled" contract as the tweaks): repaint the truth
    // silently, never a scary dialog for a deliberate No
    if (raw === "cancelled") {
      void load(true);
      return;
    }
    // an id that vanished mid-flight (deleted externally): resync silently
    // first, then explain - the list, not the error, is the news
    if (raw.includes("STARTUP_UNKNOWN_ID")) {
      void load(true);
    }
    const d = errorDialog(raw, t.errors, {
      somethingWrong: t.dialog.somethingWrong,
      scanNeedsGame: t.dialog.scanNeedsGame,
      scanNeedsGameBody: t.dialog.scanNeedsGameBody,
      unknownErrorBody: t.dialog.unknownErrorBody,
    });
    setNotice({ title: d.title, body: d.body });
  };

  const flip = async (entry: StartupEntry, next: boolean, admin: boolean) => {
    if (flippingId !== null) return; // one flip at a time, like one kill
    setFlippingId(entry.id);
    try {
      // the backend returns the re-read list: paint the verified truth,
      // never the guessed switch position. Locked rows go through one
      // system prompt first (the shield path), then this same flip.
      if (admin) {
        setEntries(await api.setStartupEnabledAdmin(entry.id, next));
      } else {
        setEntries(await api.setStartupEnabled(entry.id, next));
      }
      setError(null);
    } catch (e) {
      failNotice(e);
    } finally {
      setFlippingId(null);
    }
  };

  return (
    <div className="check-list">
      <PageIntro
        id="startup"
        headerTitle={t.startup}
        headerSub={t.startupScope}
        cardTitle={t.introStartupTitle}
        cardBody={t.introStartupBody}
        headerTrail={headerTrail}
      />
      {error ? (
        <EmptyState
          icon={<CircleGauge size={18} />}
          title={t.dialog.somethingWrong}
          hint={error}
        />
      ) : entries === null ? (
        <EmptyState icon={<CircleGauge size={18} />} title={t.loading} hint="" spin />
      ) : entries.length === 0 ? (
        <EmptyState icon={<CircleGauge size={18} />} title={t.startupEmpty} hint="" />
      ) : (
        <ul className="card proc-list">
          {entries.map((entry) => (
            <StartupRow
              key={entry.id}
              entry={entry}
              busy={flippingId === entry.id}
              onEnableRequest={(admin) => {
                setConfirmOn(entry);
                setConfirmAdmin(admin);
              }}
              onDisable={(admin) => void flip(entry, false, admin)}
            />
          ))}
        </ul>
      )}
      {/* enable confirm: names the program and its cost; turning back
          off is direct */}
      {confirmOn ? (
        <Dialog
          title={t.startupEnableConfirmTitle}
          body={t.startupEnableConfirmBody(confirmOn.name)}
          kind="confirm"
          confirmLabel={t.startupEnable}
          cancelLabel={t.dialog.cancel}
          onConfirm={() => {
            const target = confirmOn;
            const admin = confirmAdmin;
            setConfirmOn(null);
            setConfirmAdmin(false);
            void flip(target, true, admin);
          }}
          onClose={() => setConfirmOn(null)}
        />
      ) : null}
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

/** one startup row, Processes-row shaped: bare artwork (glyph tile only
    until the icon resolves, same 24px footprint so rows never shift),
    name over the lock reason when locked, and one state button (the
    button text IS the state: no separate badge, no verdict tone either
    way). Locked rows carry the shield beside the name: one system prompt
    clears the machine stamp, then the normal flip runs (turning on still
    names the program first, like every enable). */
function StartupRow(props: {
  entry: StartupEntry;
  busy: boolean;
  onEnableRequest: (admin: boolean) => void;
  onDisable: (admin: boolean) => void;
}) {
  const { entry: e, busy, onEnableRequest, onDisable } = props;
  const { t } = useLang();
  const action = e.enabled ? t.startupDisable : t.startupEnable;
  const state = e.enabled ? t.startupStateOn : t.startupStateOff;
  const label = e.locked
    ? `${action} ${e.name} (${t.startupChangeAsAdmin})`
    : `${action} ${e.name}`;
  return (
    <li className="proc-row">
      {e.icon_url ? (
        <span className="proc-art">
          <img
            className="proc-icon"
            src={e.icon_url}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        </span>
      ) : (
        <span className="icon-tile icon-func">
          <AppWindow size={15} />
        </span>
      )}
      <span className="proc-text">
        <span className="proc-name proc-name-flex">
          <span className="proc-name-text">{e.name}</span>
          {e.locked ? (
            <Shield size={13} aria-hidden="true" className="proc-lock" />
          ) : null}
        </span>
        {e.locked ? <span className="proc-ram">{t.startupLockedReason}</span> : null}
      </span>
      <button
        type="button"
        className={`focus-ring row-act startup-state${e.enabled ? " proc-end" : " startup-act"}`}
        disabled={busy}
        aria-label={label}
        onClick={() => {
          if (e.enabled) onDisable(e.locked);
          else onEnableRequest(e.locked);
        }}
      >
        {state}
      </button>
    </li>
  );
}
