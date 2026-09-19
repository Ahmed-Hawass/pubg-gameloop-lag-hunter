// ChecksView.tsx — read-only environment checks + "take me there" buttons.
// Gently live: power plan / pagefile / battery state can change while the
// user is on this tab (unplugging the charger is the classic case).

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Cpu,
  Database,
  Info,
  Plug,
  RefreshCw,
  ShieldAlert,
  Video,
  XCircle,
  Zap,
} from "lucide-react";
import { Button, Dialog, EmptyState, MODAL_OPEN_EVENT, APP_DIALOG_OPEN_EVENT } from "../components/components";
import { api, type SystemChecks } from "../bridge";
import { useLang } from "../i18n";

const LIVE_INTERVAL_MS = 30000;

export function ChecksView(props: { active: boolean; onOpenTool?: (id: string) => void }) {
  const { active, onOpenTool } = props;
  const { t } = useLang();
  const [checks, setChecks] = useState<SystemChecks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // never stack queries: a 30s tick that fires while a slow PowerShell batch
  // is still in flight is skipped, not queued (same guard as ProcessesView)
  const busyRef = useRef(false);
  // one pending slot for a manual press that lands mid-query: instead of
  // swallowing the click silently, the button spins immediately and the
  // press runs right after the in-flight query finishes — one click suffices
  const pendingManualRef = useRef(false);
  /** background-note dialog behind a card's (?) button (null = closed).
      Same unified Dialog as everywhere: one modal surface, yields to the
      App-level dialog like every view dialog. */
  const [hint, setHint] = useState<{ title: string; body: string } | null>(null);

  const load = async (silent: boolean, force = false) => {
    if (busyRef.current) {
      if (!silent) {
        pendingManualRef.current = true;
        setBusy(true);
      }
      return;
    }
    busyRef.current = true;
    if (!silent) setBusy(true);
    try {
      setChecks(await api.systemChecks(force));
      setError(null);
    } catch (e) {
      // the localized unknown-error copy, with the raw message riding
      // along as a technical line — never a bare English string in an
      // Arabic UI
      if (!silent) {
        const raw = typeof e === "string" ? e : String(e);
        setError(t.dialog.unknownErrorBody(raw));
      }
    } finally {
      busyRef.current = false;
      if (pendingManualRef.current) {
        pendingManualRef.current = false;
        void load(false, true);
      } else if (!silent) {
        setBusy(false);
      }
    }
  };

  useEffect(() => {
    void load(false);
    // mount-time fetch only: the retry button and focus handler below
    // own every later attempt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void load(true), LIVE_INTERVAL_MS);
    // returning from Windows Settings (after flipping a toggle) refreshes
    // immediately: force pays one PowerShell spawn, skipped while busy
    const onFocus = () => void load(true, true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
    // load reads busyRef/pendingManualRef (refs) and queues itself; its
    // identity is not part of the subscription contract
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // a dialog mounting under a parked cursor never fires mouseleave — tell
  // every tooltip to hide the moment ours opens (same signal as the shell)
  useEffect(() => {
    if (hint) {
      window.dispatchEvent(new Event(MODAL_OPEN_EVENT));
    }
  }, [hint]);

  // one modal surface, app-wide: an App-level dialog opening on top of
  // our hint yields it instead of stacking two overlays
  useEffect(() => {
    if (!hint) return;
    const onAppDialog = () => setHint(null);
    window.addEventListener(APP_DIALOG_OPEN_EVENT, onAppDialog);
    return () => window.removeEventListener(APP_DIALOG_OPEN_EVENT, onAppDialog);
  }, [hint]);

  // the error renders INSIDE the page, below the header: the early-return
  // version hid the Refresh button too, leaving the user stuck with a dead
  // tab until the silent 30s poll or a window focus rescued it
  if (error) {
    return (
      <div className="checks">
        <div className="checks-head">
          <p className="checks-hint">{t.checksHint}</p>
          <Button
            label={busy ? t.loading : t.refresh}
            icon={<RefreshCw size={14} className={busy ? "spin" : ""} />}
            variant="ghost"
            disabled={busy}
            onClick={() => void load(false, true)}
          />
        </div>
        <EmptyState
          icon={<ShieldAlert size={18} />}
          title={t.dialog.somethingWrong}
          hint={error}
        />
      </div>
    );
  }
  if (!checks) {
    return (
      <div className="checks">
        <div className="checks-head">
          <p className="checks-hint">{t.checksHint}</p>
          <Button
            label={busy ? t.loading : t.refresh}
            icon={<RefreshCw size={14} className={busy ? "spin" : ""} />}
            variant="ghost"
            disabled={busy}
            onClick={() => void load(false, true)}
          />
        </div>
        <EmptyState icon={<ShieldAlert size={18} />} title={t.loading} hint="" />
      </div>
    );
  }

  const pagefileText = !checks.pagefile_ok
    ? checks.pagefile_mode === "off"
      ? t.pagefileOff
      : t.pagefileManual(checks.pagefile_mb)
    : t.pagefileAuto;

  const chargerBad = checks.laptop && !checks.on_ac;

  return (
    <div className="checks">
      <div className="checks-head">
        <p className="checks-hint">{t.checksHint}</p>
        <Button
          label={busy ? t.loading : t.refresh}
          icon={<RefreshCw size={14} className={busy ? "spin" : ""} />}
          variant="ghost"
          disabled={busy}
          onClick={() => void load(false, true)}
        />
      </div>

      <div className="check-list">
        {/* power plan */}
        <div className={`check-row ${checks.power_ok ? "ok" : "warn"}`}>
          <div className="check-top">
            <span className="check-icon">
              {checks.power_ok ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
            </span>
            <span className="check-func">
              <Zap size={15} />
            </span>
            <span className="check-name">{t.checkPower}</span>
            <button
              type="button"
              className="switch-hint"
              aria-label={t.checkPower}
              onClick={() => setHint({ title: t.checkPower, body: t.checkPowerHint })}
            >
              <Info size={13} />
            </button>
            <span className={`check-badge ${checks.power_ok ? "ok" : "warn"}`}>
              {checks.power_ok ? t.checkOkBadge : t.checkWarnBadge}
            </span>
          </div>
          <p className="check-desc">{t.checkPowerDesc}</p>
          <div className="check-foot">
            <span className="check-state">
              {checks.power_ok ? t.powerOk(checks.power_name) : t.powerWarn(checks.power_name)}
            </span>
            <button
              className="check-open"
              onClick={() => {
                // High Performance has an in-app row now: stay inside the
                // app and land on it. Without the link (tests), keep the
                // Windows page — the row may still be hidden on S0/Ultimate.
                if (onOpenTool) onOpenTool("powerplan");
                else void api.openWindowsPanel("power");
              }}
            >
              {onOpenTool ? t.openInTools : t.openSettings}
            </button>
          </div>
        </div>

        {/* virtualization (VT) — read-only, BIOS change is manual by the user */}
        <div className={`check-row ${checks.vt_enabled ? "ok" : "warn"}`}>
          <div className="check-top">
            <span className="check-icon">
              {checks.vt_enabled ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
            </span>
            <span className="check-func">
              <Cpu size={15} />
            </span>
            <span className="check-name">{t.checkVt}</span>
            <button
              type="button"
              className="switch-hint"
              aria-label={t.checkVt}
              onClick={() => setHint({ title: t.checkVt, body: t.checkVtHint })}
            >
              <Info size={13} />
            </button>
            <span className={`check-badge ${checks.vt_enabled ? "ok" : "warn"}`}>
              {checks.vt_enabled ? t.checkOkBadge : t.checkWarnBadge}
            </span>
          </div>
          <p className="check-desc">{t.checkVtDesc}</p>
          <div className="check-foot">
            <span className="check-state">{checks.vt_enabled ? t.vtOk : t.vtWarn}</span>
          </div>
        </div>

        {/* background recording (Game DVR) */}
        <div className={`check-row ${checks.game_dvr_enabled ? "warn" : "ok"}`}>
          <div className="check-top">
            <span className="check-icon">
              {checks.game_dvr_enabled ? <XCircle size={17} /> : <CheckCircle2 size={17} />}
            </span>
            <span className="check-func">
              <Video size={15} />
            </span>
            <span className="check-name">{t.checkDvr}</span>
            <button
              type="button"
              className="switch-hint"
              aria-label={t.checkDvr}
              onClick={() => setHint({ title: t.checkDvr, body: t.tweakDvrHint })}
            >
              <Info size={13} />
            </button>
            <span className={`check-badge ${checks.game_dvr_enabled ? "warn" : "ok"}`}>
              {checks.game_dvr_enabled ? t.checkWarnBadge : t.checkOkBadge}
            </span>
          </div>
          <p className="check-desc">{t.checkDvrDesc}</p>
          <div className="check-foot">
            <span className="check-state">{checks.game_dvr_enabled ? t.dvrWarn : t.dvrOk}</span>
            <button
              className="check-open"
              onClick={() => {
                // DVR has an in-app fix (the Tools row): stay inside the
                // app and land on the row itself. Every other card keeps
                // its Windows page (no in-app counterpart exists yet).
                if (onOpenTool) onOpenTool("dvr");
                else void api.openWindowsPanel("gaming-captures");
              }}
            >
              {onOpenTool ? t.openInTools : t.openSettings}
            </button>
          </div>
        </div>

        {/* pagefile */}
        <div className={`check-row ${checks.pagefile_ok ? "ok" : "warn"}`}>
          <div className="check-top">
            <span className="check-icon">
              {checks.pagefile_ok ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
            </span>
            <span className="check-func">
              <Database size={15} />
            </span>
            <span className="check-name">{t.checkPagefile}</span>
            <button
              type="button"
              className="switch-hint"
              aria-label={t.checkPagefile}
              onClick={() => setHint({ title: t.checkPagefile, body: t.checkPagefileHint })}
            >
              <Info size={13} />
            </button>
            <span className={`check-badge ${checks.pagefile_ok ? "ok" : "warn"}`}>
              {checks.pagefile_ok ? t.checkOkBadge : t.checkWarnBadge}
            </span>
          </div>
          <p className="check-desc">{t.checkPagefileDesc}</p>
          <div className="check-foot">
            <span className="check-state">{pagefileText}</span>
            <button
              className="check-open"
              onClick={() => {
                // the page file has an in-app editor (the Storage
                // section): stay inside the app and land on it, like DVR
                if (onOpenTool) onOpenTool("pagefile");
                else void api.openWindowsPanel("system");
              }}
            >
              {onOpenTool ? t.openInTools : t.openSettings}
            </button>
          </div>
        </div>

        {/* charger (laptops only — hidden on desktops) */}
        {checks.laptop ? (
          <div className={`check-row ${chargerBad ? "warn" : "ok"}`}>
            <div className="check-top">
              <span className="check-icon">
                {chargerBad ? <XCircle size={17} /> : <CheckCircle2 size={17} />}
              </span>
              <span className="check-func">
                <Plug size={15} />
              </span>
              <span className="check-name">{t.checkCharger}</span>
            <button
              type="button"
              className="switch-hint"
              aria-label={t.checkCharger}
              onClick={() => setHint({ title: t.checkCharger, body: t.checkChargerHint })}
            >
              <Info size={13} />
            </button>
            <span className={`check-badge ${chargerBad ? "warn" : "ok"}`}>
                {chargerBad ? t.checkWarnBadge : t.checkOkBadge}
              </span>
            </div>
            <p className="check-desc">{t.checkChargerDesc}</p>
            <div className="check-foot">
              <span className="check-state">{chargerBad ? t.chargerWarn : t.chargerOk}</span>
            </div>
          </div>
        ) : null}
      </div>
      {/* background note behind a card's (?) button — the one unified
          Dialog, notice only */}
      {hint ? (
        <Dialog
          title={hint.title}
          body={hint.body}
          kind="notice"
          okLabel={t.dialog.ok}
          onClose={() => setHint(null)}
        />
      ) : null}
    </div>
  );
}
