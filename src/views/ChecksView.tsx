// ChecksView.tsx — read-only environment checks + "take me there" buttons.
// Gently live: power plan / pagefile / battery state can change while the
// user is on this tab (unplugging the charger is the classic case).

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Cpu,
  Database,
  HardDrive,
  Plug,
  RefreshCw,
  ShieldAlert,
  Video,
  XCircle,
  Zap,
} from "lucide-react";
import { Button, EmptyState } from "../components/components";
import { api, type SystemChecks } from "../bridge";
import { useLang } from "../i18n";

const LIVE_INTERVAL_MS = 30000;

export function ChecksView(props: { active: boolean }) {
  const { active } = props;
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
      if (!silent) setError(String(e));
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
  }, [active]);

  if (error) {
    return (
      <div className="checks">
        <EmptyState icon={<ShieldAlert size={18} />} title={t.dialog.somethingWrong} hint={error} />
      </div>
    );
  }
  if (!checks) {
    return (
      <div className="checks">
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

  const diskOk = checks.disk_level === "ok";
  const diskText = diskOk
    ? t.diskOk(checks.disk_id, Math.round(checks.disk_free_pct), Math.round(checks.disk_free_gb))
    : checks.disk_level === "critical"
      ? t.diskCritical(checks.disk_id, Math.round(checks.disk_free_pct), Math.round(checks.disk_free_gb))
      : t.diskLow(checks.disk_id, Math.round(checks.disk_free_pct), Math.round(checks.disk_free_gb));

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
            <span className={`check-badge ${checks.power_ok ? "ok" : "warn"}`}>
              {checks.power_ok ? t.checkOkBadge : t.checkWarnBadge}
            </span>
          </div>
          <p className="check-desc">{t.checkPowerDesc}</p>
          <div className="check-foot">
            <span className="check-state">
              {checks.power_ok ? t.powerOk(checks.power_name) : t.powerWarn(checks.power_name)}
            </span>
            <button className="check-open" onClick={() => void api.openWindowsPanel("power")}>
              {t.openSettings}
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
            <span className={`check-badge ${checks.game_dvr_enabled ? "warn" : "ok"}`}>
              {checks.game_dvr_enabled ? t.checkWarnBadge : t.checkOkBadge}
            </span>
          </div>
          <p className="check-desc">{t.checkDvrDesc}</p>
          <div className="check-foot">
            <span className="check-state">{checks.game_dvr_enabled ? t.dvrWarn : t.dvrOk}</span>
            <button
              className="check-open"
              onClick={() => void api.openWindowsPanel("gaming-captures")}
            >
              {t.openSettings}
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
            <span className={`check-badge ${checks.pagefile_ok ? "ok" : "warn"}`}>
              {checks.pagefile_ok ? t.checkOkBadge : t.checkWarnBadge}
            </span>
          </div>
          <p className="check-desc">{t.checkPagefileDesc}</p>
          <div className="check-foot">
            <span className="check-state">{pagefileText}</span>
            <button className="check-open" onClick={() => void api.openWindowsPanel("system")}>
              {t.openSettings}
            </button>
          </div>
        </div>

        {/* disk space */}
        <div className={`check-row ${diskOk ? "ok" : "warn"}`}>
          <div className="check-top">
            <span className="check-icon">
              {diskOk ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
            </span>
            <span className="check-func">
              <HardDrive size={15} />
            </span>
            <span className="check-name">{t.checkDisk}</span>
            <span className={`check-badge ${diskOk ? "ok" : "warn"}`}>
              {diskOk ? t.checkOkBadge : t.checkWarnBadge}
            </span>
          </div>
          <p className="check-desc">{t.checkDiskDesc}</p>
          <div className="check-foot">
            <span className="check-state">{diskText}</span>
            <button className="check-open" onClick={() => void api.openWindowsPanel("storage")}>
              {t.openSettings}
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
    </div>
  );
}
