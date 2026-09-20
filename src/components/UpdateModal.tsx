// UpdateModal.tsx — the update dialog: offer → download (progress, cancellable)
// → verified success (open folder) → failure (retry). Four states, one surface.
// Scope contract (engine/update.rs): no self-replace, no restart — the most
// this modal does is put a VERIFIED file next to the user and open its folder.

import { useEffect, useRef, useState } from "react";
import { FolderOpen, ShieldCheck, TriangleAlert } from "lucide-react";
import { api, saveDialog, type UpdateInfo } from "../bridge";
import { useLang } from "../i18n";

type Phase =
  | { kind: "offer" }
  | { kind: "downloading"; pct: number; mb: string }
  | { kind: "done"; path: string }
  | { kind: "failed"; reason: string };

function fmtMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${mb.toFixed(0)}` : `${mb.toFixed(1)}`;
}

export function UpdateModal(props: {
  info: UpdateInfo;
  onClose: () => void;
}) {
  const { info, onClose } = props;
  const { t } = useLang();
  const [phase, setPhase] = useState<Phase>({ kind: "offer" });
  // true while the offer's Download action is in flight (the OS save
  // dialog does not block the WebView — without the gate a second click
  // opened a second dialog and raced two downloads)
  const [offerBusy, setOfferBusy] = useState(false);
  // closes exactly once: Escape-during-download closes the modal, then the
  // cancelled download's promise rejects LATER and would call onClose again
  // (on an unmounted component) — the ref keeps the second call a no-op
  const closedRef = useRef(false);
  const close = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
  };

  // Escape closes the offer; while downloading it CANCELS (closing the modal
  // mid-download must never leave an orphaned stream — cancel kills it)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (phase.kind === "downloading") {
          void api.cancelUpdateDownload();
        }
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // close is a stable-once wrapper (closedRef guards the double call);
    // re-running the effect on its identity would re-arm a fired Escape
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, phase.kind]);

  // UNMOUNT mid-download = the same orphan the Escape path guards against:
  // App can swap this modal out for the advice/error dialog while the
  // stream runs (gameloop_closed push, a one-shot advice). The component
  // dies, but the engine-side download keeps streaming — cancel it here,
  // exactly like Escape does. App-level re-mounts start a fresh offer.
  useEffect(() => {
    return () => {
      if (closedRef.current) return; // an explicit close already cancelled
      // a download in flight when the modal vanished without a click:
      // the engine's cancel is idempotent, so calling it whenever a
      // downloading phase was live is safe (no download = no-op)
      if (phase.kind === "downloading") {
        void api.cancelUpdateDownload();
      }
    };
    // phase is the only reactive input and it IS the dep — no directive
    // needed; the cleanup intentionally reads the phase from THIS closure
  }, [phase.kind]);

  const startDownload = async () => {
    // one flight at a time: the OS save dialog does NOT block the WebView,
    // so a second click while it is open would open a second dialog and
    // race two downloads. The engine refuses the second registration, but
    // the UI must not even try (the same busy pattern every other button
    // in the app uses).
    if (offerBusy) return;
    setOfferBusy(true);
    try {
      // the Windows save dialog (official plugin, through the bridge): the
      // user picks the location, the official asset name comes pre-filled
      const dest = await saveDialog({
        defaultPath: info.asset_name,
        filters: [{ name: "Application", extensions: ["exe"] }],
      });
      if (!dest) return; // save dialog cancelled — back to the offer state
      // the modal may have been closed (Escape) while the OS dialog was
      // up: starting a download with no attached UI would orphan the
      // stream — same guard the failure branch uses
      if (closedRef.current) return;

      setPhase({ kind: "downloading", pct: 0, mb: "0.0" });
      const finalPath = await api.downloadUpdate(info, dest, (ev) => {
        if (ev.event === "progress") {
          const pct = ev.total > 0 ? Math.round((ev.downloaded / ev.total) * 100) : 0;
          setPhase({
            kind: "downloading",
            pct,
            mb: fmtMB(ev.downloaded),
          });
        }
        // done/failed also arrive via the command's own return — handled below
      });
      setPhase({ kind: "done", path: finalPath });
    } catch (e) {
      const reason = typeof e === "string" ? e : String(e);
      // exact match, not a substring: the backend rejects a cancelled
      // download with precisely "cancelled" — a real failure message that
      // merely CONTAINS the word must still land on the error card
      if (reason === "cancelled") {
        close(); // user cancelled — treat as a clean close, no error card
        return;
      }
      if (!closedRef.current) {
        setPhase({ kind: "failed", reason });
      }
    } finally {
      // the busy gate covers the whole offer→save-dialog→download handoff;
      // once a phase transition happened (downloading/done/failed) the
      // button is gone anyway — only a cancelled save dialog lands back on
      // the offer, and it re-opens the gate here
      setOfferBusy(false);
    }
  };

  const cancel = () => {
    void api.cancelUpdateDownload();
    close();
  };

  // ---- render per phase -----------------------------------------------

  let title = t.updateAvailableTitle;
  // declared with a definite null and reassigned in every branch below —
  // the initializers exist for type widening, not as values anyone reads
  let actions: React.ReactNode;
  let body: React.ReactNode;

  if (phase.kind === "offer") {
    body = (
      <div className="um-body">
        <div className="um-version num">
          v{info.version}
        </div>
        <div className="um-notes-label">{t.updateNotesLabel}</div>
        {/* release notes are PLAIN TEXT from the GitHub API — never HTML */}
        <p className="um-notes">{info.notes || "—"}</p>
      </div>
    );
    actions = (
      <>
        <button className="btn btn-md btn-ghost" onClick={close}>
          {t.updateClose}
        </button>
        <button
          className="btn btn-md btn-primary"
          autoFocus
          disabled={offerBusy}
          onClick={() => void startDownload()}
        >
          {t.updateDownload}
        </button>
      </>
    );
  } else if (phase.kind === "downloading") {
    title = t.updateDownloading;
    body = (
      <div className="um-body">
        <div className="progress">
          <div className="progress-fill" style={{ width: `${phase.pct}%` }} />
        </div>
        <div className="um-progress-text num">
          {phase.pct}% · {phase.mb} MB
        </div>
      </div>
    );
    actions = (
      <button className="btn btn-md btn-ghost" onClick={cancel}>
        {t.updateCancel}
      </button>
    );
  } else if (phase.kind === "done") {
    title = t.updateDoneTitle;
    body = (
      <div className="um-body">
        <div className="um-success">
          <ShieldCheck size={16} />
          <span>
            {info.asset_name}
          </span>
        </div>
        <p className="um-hint">{t.updateDoneHint}</p>
      </div>
    );
    actions = (
      <>
        <button className="btn btn-md btn-ghost" onClick={close}>
          {t.updateOk}
        </button>
        <button
          className="btn btn-md btn-primary"
          onClick={() => void api.openDownloadFolder(phase.path)}
        >
          <FolderOpen size={14} />
          {t.updateOpenFolder}
        </button>
      </>
    );
  } else {
    title = t.updateFailedTitle;
    body = (
      <div className="um-body">
        <div className="um-fail">
          <TriangleAlert size={16} />
          <span>{phase.reason}</span>
        </div>
      </div>
    );
    actions = (
      <>
        <button className="btn btn-md btn-ghost" onClick={close}>
          {t.updateClose}
        </button>
        <button
          className="btn btn-md btn-primary"
          disabled={offerBusy}
          onClick={() => void startDownload()}
        >
          {t.updateRetry}
        </button>
      </>
    );
  }

  return (
    <div className="dialog-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="dialog-box um-box" role="alertdialog" aria-modal="true">
        <h3 className="dialog-title">{title}</h3>
        {body}
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}
