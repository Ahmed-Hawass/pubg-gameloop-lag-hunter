// ChecksView.tsx — read-only environment checks + "take me there" buttons.

import { useEffect, useState } from "react";
import { CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import { EmptyState } from "../components/components";
import { api, type SystemChecks } from "../bridge";
import { useLang } from "../i18n";

export function ChecksView() {
  const { t } = useLang();
  const [checks, setChecks] = useState<SystemChecks | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .systemChecks()
      .then(setChecks)
      .catch((e) => setError(String(e)));
  }, []);

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
        <EmptyState icon={<ShieldAlert size={18} />} title={t.topProcessesRefreshing} hint="" />
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
      <p className="checks-hint">{t.checksHint}</p>

      <div className="check-list">
        {/* power plan */}
        <div className={`check-row ${checks.power_ok ? "ok" : "warn"}`}>
          <span className="check-icon">
            {checks.power_ok ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
          </span>
          <span className="check-body">
            <span className="check-name">{t.checkPower}</span>
            <span className="check-state">
              {checks.power_ok ? t.powerOk(checks.power_name) : t.powerWarn(checks.power_name)}
            </span>
          </span>
          <button className="check-open" onClick={() => void api.openWindowsPanel("power")}>
            {t.openSettings}
          </button>
        </div>

        {/* pagefile */}
        <div className={`check-row ${checks.pagefile_ok ? "ok" : "warn"}`}>
          <span className="check-icon">
            {checks.pagefile_ok ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
          </span>
          <span className="check-body">
            <span className="check-name">{t.checkPagefile}</span>
            <span className="check-state">{pagefileText}</span>
          </span>
          <button className="check-open" onClick={() => void api.openWindowsPanel("system")}>
            {t.openSettings}
          </button>
        </div>

        {/* charger (laptops only — hidden on desktops) */}
        {checks.laptop ? (
          <div className={`check-row ${chargerBad ? "warn" : "ok"}`}>
            <span className="check-icon">
              {chargerBad ? <XCircle size={17} /> : <CheckCircle2 size={17} />}
            </span>
            <span className="check-body">
              <span className="check-name">{t.checkCharger}</span>
              <span className="check-state">{chargerBad ? t.chargerWarn : t.chargerOk}</span>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
