// UpdateModal.tsx — the update dialog: offer → download (progress, cancellable)
// → verified success (open folder) → failure (retry). Four states, one surface.
// Scope contract (engine/update.rs): no self-replace, no restart — the most
// this modal does is put a VERIFIED file next to the user and open its folder.

import { useEffect, useRef, useState } from "react";
import { FolderOpen, ShieldCheck, TriangleAlert } from "lucide-react";
import { api, type UpdateInfo } from "../bridge";
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
  }, [onClose, phase.kind]);

  const startDownload = async () => {
    // the Windows save dialog (official plugin): the user picks the location,
    // the official asset name comes pre-filled
    const { save } = await import("@tauri-apps/plugin-dialog");
    const dest = await save({
      defaultPath: info.asset_name,
      filters: [{ name: "Application", extensions: ["exe"] }],
    });
    if (!dest) return; // save dialog cancelled — back to the offer state

    setPhase({ kind: "downloading", pct: 0, mb: "0.0" });
    try {
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
    }
  };

  const cancel = () => {
    void api.cancelUpdateDownload();
    close();
  };

  // ---- render per phase -----------------------------------------------

  let title = t.updateAvailableTitle;
  let actions: React.ReactNode = null;
  let body: React.ReactNode = null;

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
        <div className="um-progress">
          <div className="um-progress-fill" style={{ width: `${phase.pct}%` }} />
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
        <button className="btn btn-md btn-primary" onClick={() => void startDownload()}>
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
