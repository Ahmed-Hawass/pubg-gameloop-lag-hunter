// PagefileEditor.tsx — the Virtual Memory-style editor: one summary row
// (title + live global status) with the editor one tap under it, plus the
// pre-write confirms and the one-time reboot offer. Owns its page file
// read, its working copies, and its write busy gate; the parent only
// routes deep-links and learns when the first read settles (for the
// page-level loading/error gate).

import { useCallback, useEffect, useRef, useState } from "react";
import { Database, Info } from "lucide-react";
import { Button, Dialog, EmptyState } from "../../components/components";
import {
  api,
  notifyFeatureStateChanged,
  type PagefileSettings,
} from "../../bridge";
import { errorDialog, type Notice } from "../../errors";
import { useLang } from "../../i18n";
import { useModalSignal, useYieldToAppDialog } from "./useModalSignals";
import { summarizePagefileUsage } from "./summary";
import { syncPagefileWorkingCopies } from "./pagefileSync";

export function PagefileEditor(props: {
  active: boolean;
  /** deep-link ring target id (null = no link) */
  linkedId: string | null;
  /** first read settled (mount or retry): failed = inline error territory */
  onPfSettled: (failed: boolean) => void;
  showHint: (title: string, body: string) => void;
  failNotice: (notice: Notice | null) => void;
}) {
  const { active, linkedId, onPfSettled, showHint, failNotice } = props;
  const { t } = useLang();
  /** Virtual Memory-style editor: the backend's single read (global
      automatic flag + one live state per fixed drive). Null = not read
      yet; a failed read surfaces inline below, never a guessed editor. */
  const [pfSettings, setPfSettings] = useState<PagefileSettings | null>(null);
  /** mapped page file read-failure body (null = no failure) */
  const [pfError, setPfError] = useState<string | null>(null);
  /** working copies the user edits (dirty = a fresh read must not
      clobber typing, selection, or the checkbox) */
  const [pfAutomatic, setPfAutomatic] = useState(true);
  const [pfDrive, setPfDrive] = useState("");
  const pfDriveRef = useRef("");
  const [pfMode, setPfMode] = useState<"system" | "custom" | "off">("system");
  const [minInput, setMinInput] = useState("");
  const [maxInput, setMaxInput] = useState("");
  /** true once the user typed (a fresh read must not clobber typing) */
  const dirtyRef = useRef(false);
  /** pre-write confirm payload (null = no confirm): "off" names a
      destructive destination, "small" warns below the stutter floor */
  const [pfConfirm, setPfConfirm] = useState<{ warning: "off" | "small" } | null>(null);
  /** reboot offer after a verified page file write (once per write,
      never on load — Later dismisses for good until the next write) */
  const [rebootModal, setRebootModal] = useState(false);
  /** settled once the first read lands (the section gate waits on the
      callback, not this flag) */
  const [, setPfSettled] = useState(false);
  /** write busy gate: an elevated apply in flight (focus reads skip it,
      like the switch flips above) */
  const [writeBusy, setWriteBusy] = useState(false);
  const writeBusyRef = useRef(false);
  /** read generation: a write that starts while a read is in flight
      retires the read on arrival (same stale-paint rule as the flips) */
  const genRef = useRef(0);

  const clearPfDialogs = useCallback(() => {
    setPfConfirm(null);
    setRebootModal(false);
  }, []);
  useYieldToAppDialog(pfConfirm !== null || rebootModal, clearPfDialogs);
  useModalSignal(pfConfirm !== null || rebootModal);

  /** backend machine key to dialog body (known keys get their copy; a
      novel message rides along as the technical line, never raw English
      into an Arabic dialog) */
  const pfErrorBody = (raw: string) =>
    errorDialog(raw, t.errors, {
      somethingWrong: t.dialog.somethingWrong,
      scanNeedsGame: t.dialog.scanNeedsGame,
      scanNeedsGameBody: t.dialog.scanNeedsGameBody,
      unknownErrorBody: t.dialog.unknownErrorBody,
    }).body;

  /** fresh page file read + working-copy sync (never while the user is
      editing: dirty working copies win over live truth until applied) */
  const reloadPf = async () => {
    const gen = genRef.current;
    try {
      const pf = await api.pagefileSettings();
      if (gen !== genRef.current) return;
      setPfSettings(pf);
      setPfError(null);
      if (!dirtyRef.current) {
        // sync the working copies from live (never while the user is
        // editing); the selection survives when the drive is still
        // there, the mode falls back to custom on an unreadable drive
        // (forces an explicit choice, validation guides from there)
        const synced = syncPagefileWorkingCopies(pf, pfDriveRef.current);
        pfDriveRef.current = synced.drive;
        setPfDrive(synced.drive);
        setPfAutomatic(pf.automatic);
        setPfMode(synced.mode);
        setMinInput(synced.minInput);
        setMaxInput(synced.maxInput);
      }
      setPfSettled(true);
      onPfSettled(false);
    } catch (e) {
      if (gen !== genRef.current) return;
      // the editor reads nothing guessed: an inline honest error, the
      // rest of the page keeps working (the window-focus retry rescues)
      const raw = typeof e === "string" ? e : String(e);
      setPfSettings(null);
      setPfError(pfErrorBody(raw));
      setPfSettled(true);
      onPfSettled(true);
    }
  };

  useEffect(() => {
    if (!active) return;
    if (writeBusyRef.current) return;
    void reloadPf();
    // the read contract is about the storage page being visible;
    // reload's identity is not part of the subscription contract
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onFocus = () => {
      if (writeBusyRef.current) return;
      void reloadPf();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // same as above: reload's identity is not part of the subscription
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /** digits-only field writer (mirrors the dialog: garbage never enters,
      Arabic-Indic digits normalized, 10-char DWORD cap) */
  const writeDigits = (
    raw: string,
    set: (v: string) => void,
  ) => {
    const latin = raw.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    set(latin.replace(/\D/g, "").slice(0, 10));
    dirtyRef.current = true;
  };

  /** pick a drive in the editor: the mode + sizes prefill from that
      drive's live state (unreadable forces custom-with-empty, an
      explicit choice validation guides from there) */
  const selectPfDrive = (drive: string) => {
    if (!pfSettings) return;
    dirtyRef.current = true;
    pfDriveRef.current = drive;
    setPfDrive(drive);
    const live = pfSettings.drives.find((d) => d.drive === drive);
    setPfMode(live && live.mode !== "unknown" ? live.mode : "custom");
    setMinInput(live?.min_mb?.toString() ?? "");
    setMaxInput(live?.max_mb?.toString() ?? "");
  };

  /** one drive's mode label: system, custom with sizes, off, or
      unreadable (read, never derived from the working copies) */
  const pfModeLabel = (mode: string, min: number | null, max: number | null) =>
    mode === "custom" && min != null && max != null
      ? t.tweakPfDriveCustom(min, max)
      : mode === "system"
        ? t.tweakPfModeSystem
        : mode === "off"
          ? t.tweakPfModeOff
          : t.tweakPfModeUnknown;

  const pfLiveDrive = pfSettings?.drives.find((d) => d.drive === pfDrive);
  /** Apply dies while nothing differs from live (no dead round-trip,
      no pointless UAC): automatic flag first, then the selected drive's
      mode and sizes */
  const pfUnchanged = (() => {
    if (!pfSettings || !pfLiveDrive) return true;
    if (pfAutomatic !== pfSettings.automatic) return false;
    if (pfAutomatic) return true;
    const liveMode = pfLiveDrive.mode === "unknown" ? "custom" : pfLiveDrive.mode;
    if (pfMode !== liveMode) return false;
    if (pfMode !== "custom") return true;
    return (
      minInput === (pfLiveDrive.min_mb?.toString() ?? "") &&
      maxInput === (pfLiveDrive.max_mb?.toString() ?? "")
    );
  })();

  /** the editor write: one elevated request, verified live truth settles
      it. A verified result IS the fresh truth, so the reload below only
      refreshes the working copies (dirty cleared first). */
  const runPfApply = async () => {
    if (writeBusyRef.current || !pfSettings) return;
    genRef.current += 1;
    writeBusyRef.current = true;
    setWriteBusy(true);
    try {
      const res = await api.applyPagefileSettings(pfAutomatic, pfDrive, pfMode, minInput, maxInput);
      if (!res.verified) {
        failNotice({ title: t.dialog.somethingWrong, body: t.tweakFailed });
        return;
      }
      notifyFeatureStateChanged();
      dirtyRef.current = false;
      setPfConfirm(null);
      setRebootModal(true);
      void reloadPf();
    } catch (e) {
      const raw = typeof e === "string" ? e : String(e);
      // a refused elevation is a choice, not a failure: silent, like flips
      if (raw === "cancelled") return;
      failNotice({ title: t.dialog.somethingWrong, body: pfErrorBody(raw) });
    } finally {
      writeBusyRef.current = false;
      setWriteBusy(false);
    }
  };

  /** Apply entry: the backend validates first (keys, never sentences)
      for the confirm step ("off" and "small" pause on a confirm, clean
      requests go straight to the write). */
  const applyPf = async () => {
    if (writeBusyRef.current || !pfSettings || pfUnchanged) return;
    try {
      const warning = await api.validatePagefileSettings(
        pfAutomatic,
        pfDrive,
        pfMode,
        minInput,
        maxInput,
      );
      if (warning === "off" || warning === "small") {
        setPfConfirm({ warning });
        return;
      }
    } catch (e) {
      const raw = typeof e === "string" ? e : String(e);
      if (raw === "cancelled") return;
      failNotice({ title: t.dialog.somethingWrong, body: pfErrorBody(raw) });
      return;
    }
    void runPfApply();
  };

  // RAM for the strip, rounded to whole GB for a quiet readout
  // (31.9 GB installs read "32 GB RAM", never a jittery decimal)
  const ramGb =
    pfSettings?.ram_total_mb != null
      ? Math.round(pfSettings.ram_total_mb / 1024)
      : null;
  /** committed sizes for the "Currently using" strip line (null = no
      line: automatic mode or nothing live — never a guessed number) */
  const pfUsage = summarizePagefileUsage(pfSettings);

  return (
    <>
      {/* read failure: the editor shows nothing guessed (an inline
          honest error; the window-focus retry is the rescue) */}
      {pfError ? (
        <EmptyState
          icon={<Database size={18} />}
          title={t.dialog.somethingWrong}
          hint={pfError}
        />
      ) : null}
      {/* the editor owns its page open: no summary row, no collapse.
          The strip up top names what Windows holds now (committed sizes
          in manual mode, installed RAM always); the mode itself lives
          on the checkbox underneath, so no state is stated twice. The
          deep-link ring lands on this card. */}
      {pfSettings ? (
        <div
          data-tweak="pagefile"
          className={`card-sm pf-form${linkedId === "pagefile" ? " is-linked" : ""}`}
        >
          <div className="pf-status-strip">
            {pfUsage ? (
              <span className="pf-status-state">
                {pfUsage.allSystem
                  ? t.pfSystemSizes(pfUsage.live)
                  : t.pfCurrentlyUsing(
                      pfUsage.sumMb.toLocaleString("en-US"),
                      pfUsage.live,
                    )}
              </span>
            ) : null}
            {ramGb !== null ? (
              <span className="pf-status-ram">{t.pfRamInstalled(ramGb)}</span>
            ) : null}
            <button
              type="button"
              className="switch-hint"
              aria-label={t.tweakPfTitle}
              onClick={() => showHint(t.tweakPfTitle, t.tweakPfHint)}
            >
              <Info size={13} />
            </button>
          </div>
          <label className="pf-auto">
            <input
              type="checkbox"
              checked={pfAutomatic}
              disabled={writeBusy}
              onChange={(e) => {
                dirtyRef.current = true;
                setPfAutomatic(e.target.checked);
              }}
            />
            <span>{t.tweakPfAutoLabel}</span>
          </label>
          <div className={pfAutomatic ? "pf-manual is-disabled" : "pf-manual"}>
            <span className="switch-desc">{t.tweakPfDrivesLabel}</span>
            <div className="pf-drives" role="radiogroup" aria-label={t.tweakPfDrivesLabel}>
              {pfSettings.drives.map((d) => (
                <button
                  key={d.drive}
                  type="button"
                  role="radio"
                  aria-checked={d.drive === pfDrive}
                  className={`pf-drive${d.drive === pfDrive ? " is-selected" : ""}`}
                  disabled={writeBusy || pfAutomatic}
                  onClick={() => selectPfDrive(d.drive)}
                >
                  <span className="pf-drive-id num">{d.drive}</span>
                  <span className="pf-drive-free">
                    {d.free_mb == null
                      ? t.tweakPfDriveNoSpaceShort
                      : t.tweakPfDriveFreeShort(Math.round(d.free_mb / 1024))}
                  </span>
                  <span className="pf-drive-mode">
                    {pfModeLabel(d.mode, d.min_mb, d.max_mb)}
                  </span>
                </button>
              ))}
            </div>
            {/* the mode in the app's own selection language (the same
                segmented pills as language/theme): one tap, the active
                segment fills */}
            <span className="switch-desc">{t.tweakPfModeLabel}</span>
            <div className="lang-segment" role="radiogroup" aria-label={t.tweakPfTitle}>
              {(
                [
                  ["system", t.tweakPfModeSystem],
                  ["custom", t.tweakPfModeCustom],
                  ["off", t.tweakPfModeOff],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={pfMode === mode}
                  className={`lang-seg${pfMode === mode ? " is-active" : ""}`}
                  disabled={writeBusy || pfAutomatic}
                  onClick={() => {
                    dirtyRef.current = true;
                    setPfMode(mode);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="pf-fields">
              <label className="pf-field">
                <span>{t.tweakPfMinLabel}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  value={minInput}
                  disabled={writeBusy || pfAutomatic || pfMode !== "custom"}
                  onChange={(e) => writeDigits(e.target.value, setMinInput)}
                />
              </label>
              <label className="pf-field">
                <span>{t.tweakPfMaxLabel}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  value={maxInput}
                  disabled={writeBusy || pfAutomatic || pfMode !== "custom"}
                  onChange={(e) => writeDigits(e.target.value, setMaxInput)}
                />
              </label>
            </div>
            {/* engine recommendation for the installed RAM: a starting
                point next to the inputs, never a gate (hidden when RAM
                is unreadable instead of recommending for nothing) */}
            {pfSettings.ram_total_mb != null &&
            pfSettings.recommended_min_mb != null &&
            pfSettings.recommended_max_mb != null ? (
              <p className="tool-note">
                {t.pfRecommend(
                  Math.round(pfSettings.ram_total_mb / 1024),
                  pfSettings.recommended_min_mb,
                  pfSettings.recommended_max_mb,
                )}
              </p>
            ) : null}
            <Button
              label={t.tweakPfApply}
              className="pf-apply"
              disabled={writeBusy || pfUnchanged}
              onClick={() => void applyPf()}
            />
          </div>
        </div>
      ) : null}
      {/* pending reboot note, inside the card (self-clearing on reboot,
          no writes) */}
      {pfSettings && pfSettings.pending ? (
        <p className="tool-note">{t.tweakPfPending}</p>
      ) : null}
      {/* pre-write confirm from the backend's validate step: "off"
          names its destructive destination like a delete (danger
          styling), "small" warns below the diagnosed stutter floor but
          allows (the engine floor constant is the same number) */}
      {pfConfirm ? (
        <Dialog
          title={
            pfConfirm.warning === "off"
              ? t.tweakPfWarnOffTitle(pfDrive)
              : t.tweakPfWarnSmallTitle
          }
          body={
            pfConfirm.warning === "off"
              ? t.tweakPfWarnOffBody(pfDrive)
              : t.tweakPfWarnSmallBody(pfDrive, parseInt(maxInput, 10) || 0)
          }
          kind="confirm"
          danger={pfConfirm.warning === "off"}
          confirmLabel={t.tweakPfApply}
          cancelLabel={t.dialog.cancel}
          onConfirm={() => {
            setPfConfirm(null);
            void runPfApply();
          }}
          onClose={() => setPfConfirm(null)}
        />
      ) : null}
      {/* reboot offer, once per verified write (Later dismisses until
          the next write — never nagged on load) */}
      {rebootModal ? (
        <Dialog
          title={t.rebootTitle}
          body={t.rebootBody}
          kind="confirm"
          confirmLabel={t.rebootNow}
          cancelLabel={t.rebootLater}
          onConfirm={() => {
            setRebootModal(false);
            void api
              .scheduleReboot()
              .catch(() => failNotice({ title: t.dialog.somethingWrong, body: t.tweakFailed }));
          }}
          onClose={() => setRebootModal(false)}
        />
      ) : null}
    </>
  );
}
