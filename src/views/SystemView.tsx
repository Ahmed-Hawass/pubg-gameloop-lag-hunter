// SystemView.tsx — the gamer's rig page: what you have + what we can see.

import { useEffect, useRef, useState } from "react";
import { Cpu, Gauge, HardDrive, MemoryStick, RefreshCw } from "lucide-react";
import { Button, EmptyState, Hint } from "../components/components";
import { api, type SystemInfo } from "../bridge";
import { errorDialog } from "../errors";
import { useLang } from "../i18n";

export function SystemView() {
  const { t } = useLang();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const load = async () => {
    if (busyRef.current) return; // never stack queries
    busyRef.current = true;
    setBusy(true);
    try {
      setInfo(await api.systemInfo());
      setError(null);
    } catch (e) {
      // known backend keys render their locale copy (substring match, so an
      // "engine error: CODE" wrapper still resolves); novel failures fall
      // back to the generic copy with the raw message as technical line
      const raw = typeof e === "string" ? e : String(e);
      setError(
        errorDialog(raw, t.errors, {
          somethingWrong: t.dialog.somethingWrong,
          scanNeedsGame: t.dialog.scanNeedsGame,
          scanNeedsGameBody: t.dialog.scanNeedsGameBody,
          unknownErrorBody: t.dialog.unknownErrorBody,
        }).body,
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // first data. A transient PowerShell failure used to leave this tab
  // dead until app restart (single mount-time fetch, keep-alive tab, no
  // retry path) — now the error state carries a retry button and a
  // window-focus re-read.
  const errorNow = error;
  useEffect(() => {
    void load();
    // mount-time fetch only: the retry button and focus handler below
    // own every later attempt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!errorNow) return;
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // load re-resolves the fresh locale through its closure on every
    // focus fire — its identity is not part of the subscription contract
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorNow]);

  if (error) {
    return (
      <div className="sys">
        <EmptyState icon={<Cpu size={18} />} title={t.dialog.somethingWrong} hint={error} />
        <div className="sys-retry">
          <Button
            label={t.updateRetry}
            icon={<RefreshCw size={15} />}
            variant="ghost"
            disabled={busy}
            onClick={() => void load()}
          />
        </div>
      </div>
    );
  }
  if (!info) {
    return (
      <div className="sys">
        <EmptyState icon={<Cpu size={18} />} title={t.loading} hint="" />
      </div>
    );
  }

  return (
    <div className="sys">
      {/* the rig */}
      <section className="sys-section">
        <h3 className="sys-title">{t.yourRig}</h3>
        <div className="sys-grid">
          <div className="sys-kv">
            <Cpu size={15} />
            <span className="sys-k">{info.cpu}</span>
          </div>
          {info.gpus.map((g, i) => (
            <div key={i} className="sys-kv">
              <Gauge size={15} />
              <span className="sys-k">
                {g.name}
                {g.vram_gb ? ` · ${g.vram_gb} ${t.gbUnit}` : ""}
              </span>
            </div>
          ))}
          <div className="sys-kv">
            <MemoryStick size={15} />
            <span className="sys-k">
              {info.ram_gb} {t.gbUnit} {t.ramUnit}
            </span>
          </div>
          {info.disks.map((d, i) => (
            <div key={i} className="sys-kv">
              <HardDrive size={15} />
              <span className="sys-k">
                {d.name} · {d.size_gb} {t.gbUnit} · {d.media}/{d.bus}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* what we can see */}
      <section className="sys-section">
        <h3 className="sys-title">
          {t.whatWeSee}
          <Hint text={t.whatWeSeeHint} />
        </h3>
        <ul className="sys-see">
          <li className="ok">
            <span className="see-dot ok" />
            {t.seeCpu}
          </li>
          <li className={info.gpu_counters ? "ok" : "off"}>
            <span className={`see-dot ${info.gpu_counters ? "ok" : "off"}`} />
            {info.gpu_counters ? t.seeGpu : t.gpuCountersOff}
          </li>
          <li className={info.powershell_available ? "ok" : "off"}>
            <span className={`see-dot ${info.powershell_available ? "ok" : "off"}`} />
            {info.powershell_available ? t.seePs : t.seePsOff}
          </li>
          <li className="ok">
            <span className="see-dot ok" />
            {t.seeGame}
          </li>
        </ul>
      </section>
    </div>
  );
}
