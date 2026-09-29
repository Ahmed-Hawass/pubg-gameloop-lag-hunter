// SweepSection.tsx — the storage sweep: manual scan of the safe places,
// delete only the ticked ones. Fully self-owned (page header, state,
// runners, confirm): the section never scans by itself, the Scan button
// below is the only trigger, so the sweep costs nothing until asked.

import { useCallback, useRef, useState } from "react";
import { CheckCircle2, Info, Trash2 } from "lucide-react";
import { Button, Dialog } from "../../components/components";
import { api, type CleanupCategory, type CleanupResult, type CleanupScan } from "../../bridge";
import type { Notice } from "../../errors";
import { useLang } from "../../i18n";
import { useModalSignal, useYieldToAppDialog } from "./useModalSignals";

export function SweepSection(props: {
  showHint: (title: string, body: string) => void;
  failNotice: (notice: Notice | null) => void;
  /** reports cleanup activity to the shell (the exit confirm needs it) */
  onCleaningChange?: (active: boolean) => void;
}) {
  const { showHint, failNotice, onCleaningChange } = props;
  const { t } = useLang();
  /** storage sweep: measured places + memory (null = never scanned),
      ticked ids, last clean result, confirm gate, and scan-read failure.
      Own busy ref so a scan/clean never blocks the switches above. */
  const [clScan, setClScan] = useState<CleanupScan | null>(null);
  const [clChecked, setClChecked] = useState<string[]>([]);
  const [clResult, setClResult] = useState<CleanupResult[] | null>(null);
  const [clScanError, setClScanError] = useState<string | null>(null);
  const [clConfirm, setClConfirm] = useState(false);
  const [clBusy, setClBusy] = useState(false);
  const clBusyRef = useRef(false);
  /** payoff flash: true from a successful clean until the next scan
      starts — the cleaned hero owns the moment, then the work card
      takes back over with fresh truth */
  const [clCleanedFlash, setClCleanedFlash] = useState(false);
  /** deep scan answer (null = never asked). Deep places are NEVER
      auto-ticked, however big they measure. The card flips to
      whichever scan ran last: one list visible, one selection shared. */
  const [clDeep, setClDeep] = useState<CleanupScan | null>(null);
  const [clDeepError, setClDeepError] = useState<string | null>(null);
  /** scan mode doubles as the visible set: one toggle, one Scan button,
      no twin buttons. A completed scan flips the mode to its own
      results; flipping the toggle by hand only switches the display. */
  const [clMode, setClMode] = useState<"quick" | "deep">("quick");
  /** live progress: current step; phase tells scan apart from clean */
  const [clProg, setClProg] = useState<{ index: number; total: number; id: string } | null>(null);
  const [clPhase, setClPhase] = useState<"scan" | "clean" | null>(null);

  const clYield = useCallback(() => setClConfirm(false), []);
  useYieldToAppDialog(clConfirm, clYield);
  useModalSignal(clConfirm);

  /** sweep helpers: machine id to translated name/hint, measured bytes
      to a Latin-unit size (units stay Latin in Arabic, like every other
      measurement), and the scan/clean runners with the ref busy gate */
  // the backend only ever sends the known ids; an unknown one
  // falls back to the raw id itself (never a sibling's name)
  const clNames: Record<string, string> = {
    user_temp: t.cleanupCatUserTemp,
    system_temp: t.cleanupCatSystemTemp,
    recycle_bin: t.cleanupCatRecycle,
    delivery_opt: t.cleanupCatDelivery,
    thumb_cache: t.cleanupCatThumb,
    error_reports: t.cleanupCatReports,
    old_minidumps: t.cleanupCatDumps,
    update_download: t.cleanupCatDownload,
    system_logs: t.cleanupCatLogs,
  };
  const clName = (id: string) => clNames[id] ?? id;
  /** categorical dot/bar color per place (identity, never severity:
      fixed hues readable on both themes, unknown ids fall muted) */
  const CL_CATEGORY_COLORS: Record<string, string> = {
    user_temp: "#58B368",
    system_temp: "#45B8AC",
    recycle_bin: "#8A8F98",
    delivery_opt: "#4FA8D8",
    thumb_cache: "#D8A64F",
    error_reports: "#E07A5F",
    old_minidumps: "#9B7EBD",
    update_download: "#D48BC0",
    system_logs: "#A3C14A",
  };
  const clColor = (id: string) => CL_CATEGORY_COLORS[id] ?? "#8A8F98";
  const clHintBodies: Record<string, string> = {
    user_temp: t.cleanupCatUserTempHint,
    system_temp: t.cleanupCatSystemTempHint,
    recycle_bin: t.cleanupCatRecycleHint,
    delivery_opt: t.cleanupCatDeliveryHint,
    thumb_cache: t.cleanupCatThumbHint,
    error_reports: t.cleanupCatReportsHint,
    old_minidumps: t.cleanupCatDumpsHint,
    update_download: t.cleanupCatDownloadHint,
    system_logs: t.cleanupCatLogsHint,
  };
  const clHintBody = (id: string) => clHintBodies[id] ?? t.cleanupDesc;
  const clSize = (bytes: number | null) => {
    if (bytes == null) return "--";
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };
  const clProgress = (phase: "scan" | "clean") => (ev: { event: string; id: string; index: number; total: number }) => {
    if (ev.event !== "category") return;
    setClPhase(phase);
    setClProg({ index: ev.index, total: ev.total, id: ev.id });
  };
  const runClScan = async () => {
    if (clBusyRef.current) return;
    clBusyRef.current = true;
    setClBusy(true);
    setClCleanedFlash(false);
    setClProg(null);
    setClPhase("scan");
    setClScanError(null);
    try {
      const scan = await api.storageScan(clProgress("scan"));
      setClScan(scan);
      setClMode("quick");
      // every non-empty place ticked by default (the user unticks, never
      // us); zero/unknown rows render muted with a disabled checkbox
      setClChecked(
        scan.categories.filter((c) => (c.bytes ?? 0) > 0).map((c) => c.id),
      );
      setClResult(null);
    } catch {
      setClScanError(t.cleanupScanFailed);
    } finally {
      clBusyRef.current = false;
      setClBusy(false);
      setClProg(null);
      setClPhase(null);
    }
  };
  const runClDeepScan = async () => {
    if (clBusyRef.current) return;
    clBusyRef.current = true;
    setClBusy(true);
    setClCleanedFlash(false);
    setClProg(null);
    setClPhase("scan");
    setClDeepError(null);
    try {
      const deep = await api.storageDeepScan(clProgress("scan"));
      setClDeep(deep);
      setClMode("deep");
      // opt-in means opt-in: deep places are never auto-ticked, however
      // big they measure. The user ticks, never us.
    } catch {
      setClDeepError(t.cleanupScanFailed);
    } finally {
      clBusyRef.current = false;
      setClBusy(false);
      setClProg(null);
      setClPhase(null);
    }
  };
  const runClClean = async () => {
    if (clBusyRef.current || clCleanIds.length === 0) return;
    setClConfirm(false);
    clBusyRef.current = true;
    setClBusy(true);
    setClCleanedFlash(false);
    onCleaningChange?.(true);
    setClProg(null);
    setClPhase("clean");
    try {
      const res = await api.storageClean(clCleanIds, clProgress("clean"));
      setClResult(res);
      setClCleanedFlash(true);
      // re-measure so the list shows the verified live truth, not hope
      // (both groups when both were scanned)
      try {
        const freshScan = await api.storageScan(clProgress("scan"));
        setClScan(freshScan);
        let freshCategories = [...freshScan.categories];
        if (clDeep !== null) {
          const freshDeep = await api.storageDeepScan(clProgress("scan"));
          setClDeep(freshDeep);
          freshCategories = [...freshCategories, ...freshDeep.categories];
        }
        setClChecked((prev) =>
          prev.filter((id) =>
            freshCategories.some((c) => c.id === id && (c.bytes ?? 0) > 0),
          ),
        );
      } catch {
        // the clean already verified by re-measure inside; a failed
        // refresh only leaves the old sizes painted, never wrong data
      }
    } catch (e) {
      const raw = typeof e === "string" ? e : String(e);
      // a refused elevation is a choice, not a failure (same
      // exact-"cancelled" contract as the switch flips above)
      if (raw === "cancelled") return;
      failNotice({ title: t.dialog.somethingWrong, body: t.dialog.unknownErrorBody(raw) });
    } finally {
      clBusyRef.current = false;
      setClBusy(false);
      onCleaningChange?.(false);
      setClProg(null);
      setClPhase(null);
    }
  };
  // unknown verdicts add nothing to the hero number (a null is not a
  // zero); the note below owns the honesty instead
  const clFreedBytes = clResult
    ? clResult.reduce((s, r) => s + (r.freed_bytes ?? 0), 0)
    : 0;
  const clUnmeasured = clResult?.some((r) => r.freed_bytes == null) ?? false;
  /** hero number: GB above 1 GB, MB below (Latin units either way) */
  const clHero =
    clFreedBytes >= 1073741824
      ? { num: (clFreedBytes / 1073741824).toFixed(1), unit: "GB" }
      : { num: (clFreedBytes / 1048576).toFixed(1), unit: "MB" };
  const clFreedMb = Math.round((clFreedBytes / 1048576) * 10) / 10;
  /** one row per measured place (shared by both groups so the two lists
      can never drift apart in behavior) */
  const renderClRows = (cats: CleanupCategory[]) =>
    cats.map((c) => {
      // zero/unknown rows stay visible but muted with a
      // disabled checkbox: nothing to decide, nothing to
      // clean (and an unmeasured clean could never report
      // an honest freed number)
      const empty = (c.bytes ?? 0) <= 0;
      return (
        <div key={c.id} className={`inset-row cleanup-row${empty ? " is-empty" : ""}`}>
          <span
            className="cleanup-dot"
            style={{ background: clColor(c.id) }}
            aria-hidden="true"
          />
          <input
            type="checkbox"
            aria-label={clName(c.id)}
            checked={clChecked.includes(c.id)}
            disabled={clBusy || empty}
            onChange={(e) =>
              setClChecked((prev) =>
                e.target.checked
                  ? [...prev, c.id]
                  : prev.filter((id) => id !== c.id),
              )
            }
          />
          <span className="cleanup-name">
            <span className="cleanup-title">
              {clName(c.id)}
              <button
                type="button"
                className="switch-hint"
                aria-label={clName(c.id)}
                onClick={() => {
                  showHint(clName(c.id), clHintBody(c.id));
                }}
              >
                <Info size={13} />
              </button>
            </span>
          </span>
          <span className="cleanup-size">{clSize(c.bytes)}</span>
        </div>
      );
    });
  /** visible rows (the mode): the toggle below acts on these only,
      never on the hidden set behind the mode */
  const clModeScan = clMode === "deep" ? clDeep : clScan;
  const clVisible = clModeScan?.categories ?? [];
  /** Clean acts on the visible set only: rows ticked in Quick then
      hidden behind the Deep flip are never swept along silently. The
      "Selected" line counts the same ids Clean will take. */
  const clCleanIds = clChecked.filter((id) => clVisible.some((c) => c.id === id));
  const clSelectedBytes = clVisible
    .filter((c) => clCleanIds.includes(c.id))
    .reduce((s, c) => s + (c.bytes ?? 0), 0);
  const clTickable = clVisible.filter((c) => (c.bytes ?? 0) > 0);
  /** breakdown bar inputs: measured places of the visible set, share of
      their own total (a zero total hides the bar, never a flat one) */
  const clMeasured = clVisible.filter((c) => (c.bytes ?? 0) > 0);
  const clMeasuredTotal = clMeasured.reduce((s, c) => s + (c.bytes ?? 0), 0);
  /** scanned this session (either group): the work card replaces the
      idle hero from here on */
  const clScanned = clScan !== null || clDeep !== null;
  const clAllTicked =
    clTickable.length > 0 && clTickable.every((c) => clChecked.includes(c.id));
  const toggleClAll = () => {
    if (clBusy) return;
    setClChecked((prev) =>
      clAllTicked
        ? prev.filter((id) => !clTickable.some((c) => c.id === id))
        : [
            ...prev,
            ...clTickable.map((c) => c.id).filter((id) => !prev.includes(id)),
          ],
    );
  };
  return (
    <div className="check-list">
      {/* plain page header (not a card, not collapsible): the shell
          back button above already says where this lives */}
      <div className="page-head">
        <span className="icon-tile">
          <Trash2 size={18} />
        </span>
        <span className="page-head-text">
          <span className="page-head-title">{t.toolCleanup}</span>
          <span className="page-head-desc">{t.toolCleanupDesc}</span>
        </span>
      </div>
      {/* cleaned payoff first: right after a verified clean the card
          celebrates the measured number with a way back (Scan again).
          The work card below takes over on the next scan. */}
      {clCleanedFlash && clResult ? (
        <div className="card-sm cleanup-cleaned">
          <span className="cleanup-done">
            <CheckCircle2 size={30} aria-hidden="true" />
          </span>
          <div className="cleanup-hero">
            <span className="cleanup-hero-num">{clHero.num}</span>
            <span className="cleanup-hero-unit">{clHero.unit}</span>
          </div>
          <p className="cleanup-result">{t.cleanupFreed(clFreedMb)}</p>
          {clUnmeasured ? <p className="tool-note">{t.cleanupUnmeasured}</p> : null}
          <p className="cleanup-tagline">{t.cleanupCleanedTag}</p>
          <Button
            label={t.cleanupRescan}
            disabled={clBusy}
            onClick={() => void (clMode === "deep" ? runClDeepScan() : runClScan())}
          />
        </div>
      ) : (
        <div className="card-sm cleanup">
          {/* idle hero: the only invitation before the first scan
              (mode pills + Scan ride below it, like the concept) */}
          {!clScanned && !clBusy ? (
            <div className="cleanup-idle">
              <span className="cleanup-idle-icon">
                <Trash2 size={26} aria-hidden="true" />
              </span>
              <div className="cleanup-idle-title">{t.cleanupTitle}</div>
              <div className="cleanup-idle-desc">{t.cleanupDesc}</div>
            </div>
          ) : null}
          {clScanError ? <p className="tool-note">{clScanError}</p> : null}
          {clDeepError ? <p className="tool-note">{clDeepError}</p> : null}
          {/* one toggle for the visible list only (the flip hides a
              set; the toggle never touches what the user cannot see) */}
          {clTickable.length > 0 ? (
            <div className="cleanup-actions">
              <Button
                label={clAllTicked ? t.cleanupDeselectAll : t.cleanupSelectAll}
                variant="ghost"
                disabled={clBusy}
                onClick={toggleClAll}
              />
            </div>
          ) : null}
          {/* mode toggle first: one control decides what Scan
              measures and what the list shows. No twin buttons. */}
          <div className="cleanup-actions" role="radiogroup" aria-label={t.cleanupTitle}>
            {(["quick", "deep"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={clMode === m}
                className={`lang-seg${clMode === m ? " is-active" : ""}`}
                disabled={clBusy}
                onClick={() => setClMode(m)}
              >
                {m === "quick" ? t.cleanupModeQuick : t.cleanupModeDeep}
              </button>
            ))}
          </div>
          {/* scanned hero: what the ticked rows would free right now,
              with the per-place breakdown bar under it */}
          {clScanned && clSelectedBytes > 0 && !clBusy ? (
            <>
              <div className="cleanup-hero">
                <span className="cleanup-hero-num">
                  {clSelectedBytes >= 1073741824
                    ? (clSelectedBytes / 1073741824).toFixed(1)
                    : (clSelectedBytes / 1048576).toFixed(1)}
                </span>
                <span className="cleanup-hero-unit">
                  {clSelectedBytes >= 1073741824 ? "GB" : "MB"}
                </span>
              </div>
              <p className="cleanup-result">{t.cleanupReadyToFree}</p>
            </>
          ) : null}
          {clScanned && clMeasuredTotal > 0 && !clBusy ? (
            <div className="cleanup-bars" aria-hidden="true">
              {clMeasured.map((c) => (
                <span
                  key={c.id}
                  style={{
                    width: `${((c.bytes ?? 0) / clMeasuredTotal) * 100}%`,
                    background: clColor(c.id),
                  }}
                />
              ))}
            </div>
          ) : null}
          {/* one list visible: the mode's own results, on an inset
              surface with dividers. Selection stays
              shared, so Clean always acts on every ticked row. */}
          {clModeScan ? (
            <div className="inset-list">{renderClRows(clModeScan.categories)}</div>
          ) : null}
          {/* all-unreadable is a read failure, not a clean drive:
              "--" everywhere must never read as "nothing to clean".
              Both groups count: deep rows join the verdict once
              scanned. */}
          {(clScan ?? clDeep) &&
          !clBusy &&
          [
            ...(clScan?.categories ?? []),
            ...(clDeep?.categories ?? []),
          ].every((c) => c.bytes == null) ? (
            <p className="tool-note">{t.cleanupScanFailed}</p>
          ) : null}
          {(clScan ?? clDeep) &&
          !clBusy &&
          [
            ...(clScan?.categories ?? []),
            ...(clDeep?.categories ?? []),
          ].some((c) => c.bytes != null) &&
          [
            ...(clScan?.categories ?? []),
            ...(clDeep?.categories ?? []),
          ].every((c) => (c.bytes ?? 0) <= 0) ? (
            <p className="tool-note">{t.cleanupNothing}</p>
          ) : null}
          {/* live progress: one step per category (honest granularity,
              never a fake per-byte bar) */}
          {clBusy && clProg ? (
            <div className="cleanup-progress" role="status">
              <div className="progress progress-md">
                <div
                  className="progress-fill"
                  style={{ width: `${((clProg.index + 1) / Math.max(clProg.total, 1)) * 100}%` }}
                />
              </div>
              <p className="tool-note">
                {clPhase === "clean"
                  ? t.cleanupCleaningCat(clName(clProg.id))
                  : t.cleanupScanningCat(clName(clProg.id))}
              </p>
            </div>
          ) : null}
          {clBusy && !clProg ? <p className="tool-note">{t.cleanupScanning}</p> : null}
          {/* footer: both actions pinned to the end side (the hero
              above already counts what Clean will take) */}
          <div className="cleanup-foot">
            <span className="cleanup-foot-btns">
              <Button
                label={
                  clMode === "deep"
                    ? clDeep
                      ? t.cleanupRescan
                      : t.cleanupDeepScan
                    : clScan
                      ? t.cleanupRescan
                      : t.cleanupScan
                }
                variant="ghost"
                disabled={clBusy}
                onClick={() => void (clMode === "deep" ? runClDeepScan() : runClScan())}
              />
              {clModeScan ? (
                <Button
                  label={clBusy ? t.cleanupCleaning : t.cleanupClean}
                  disabled={clBusy || clCleanIds.length === 0}
                  // no empty-selection error path: the disabled gate
                  // above makes it unreachable (dead code is a lie)
                  onClick={() => setClConfirm(true)}
                />
              ) : null}
            </span>
          </div>
        </div>
      )}
      {/* destructive confirm (recycle bin is permanent): names the
          ticked places like the pagefile-off confirm names its drive */}
      {clConfirm ? (
        <Dialog
          title={t.cleanupConfirmTitle}
          body={t.cleanupConfirmBody(clCleanIds.map(clName).join(", "))}
          kind="confirm"
          danger
          confirmLabel={t.cleanupClean}
          cancelLabel={t.dialog.cancel}
          onConfirm={() => void runClClean()}
          onClose={() => setClConfirm(false)}
        />
      ) : null}
    </div>
  );
}
