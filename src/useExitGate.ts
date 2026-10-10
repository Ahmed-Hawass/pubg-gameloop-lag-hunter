// useExitGate.ts — the X-button gate: quiet work closes straight away,
// a running scan, an active download, or a running cleanup names itself
// in one confirm instead. Extracted from App without behavior change:
// the refs keep the request reading live state without re-subscribing,
// and confirming rides the normal close path so the backend safety net
// (cancel download, stop + save the session) runs.

import { useCallback, useEffect, useRef, useState } from "react";
import { closeWindow, type StatusPayload } from "./bridge";
import { dispatchAppDialogOpen } from "./components/components";

export interface ExitBlockers {
  scan: boolean;
  download: boolean;
  cleaning: boolean;
}

export function useExitGate(status: StatusPayload): {
  exitConfirm: ExitBlockers | null;
  setExitConfirm: (b: ExitBlockers | null) => void;
  onDownloadActivity: (active: boolean) => void;
  onCleaningActivity: (active: boolean) => void;
  requestExit: () => void;
} {
  const [exitConfirm, setExitConfirm] = useState<ExitBlockers | null>(null);
  /** live mirrors for the exit gate (refs: the request reads them without
      re-subscribing; running/stopping both count as an active scan) */
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const downloadActiveRef = useRef(false);
  const cleaningActiveRef = useRef(false);
  const onDownloadActivity = useCallback((active: boolean) => {
    downloadActiveRef.current = active;
  }, []);
  const onCleaningActivity = useCallback((active: boolean) => {
    cleaningActiveRef.current = active;
  }, []);
  /** the X button path: quiet work closes straight away; a running scan,
      an active download, or a running cleanup names itself in one confirm
      instead. Cancelling is non-destructive (nothing was ever requested
      at OS level); confirming rides the normal close path, so the
      backend safety net (cancel download, stop + save the session) runs. */
  const requestExit = useCallback(() => {
    const blockers = {
      scan: statusRef.current.status === "running" || statusRef.current.status === "stopping",
      download: downloadActiveRef.current,
      cleaning: cleaningActiveRef.current,
    };
    if (!blockers.scan && !blockers.download && !blockers.cleaning) {
      void closeWindow();
      return;
    }
    setExitConfirm(blockers);
    dispatchAppDialogOpen();
  }, []);
  return { exitConfirm, setExitConfirm, onDownloadActivity, onCleaningActivity, requestExit };
}
