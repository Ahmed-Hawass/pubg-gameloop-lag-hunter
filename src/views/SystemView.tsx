// SystemView.tsx — the gamer's rig page: what you have + what we can see.

import { useEffect, useState } from "react";
import { Cpu, Gauge, HardDrive, MemoryStick } from "lucide-react";
import { EmptyState, Hint } from "../components/components";
import { api, type SystemInfo } from "../bridge";
import { useLang } from "../i18n";

export function SystemView() {
  const { t } = useLang();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .systemInfo()
      .then(setInfo)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="sys">
        <EmptyState icon={<Cpu size={18} />} title={t.dialog.somethingWrong} hint={error} />
      </div>
    );
  }
  if (!info) {
    return (
      <div className="sys">
        <EmptyState icon={<Cpu size={18} />} title={t.topProcessesRefreshing} hint="" />
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
                {g.vram_gb ? ` · ${g.vram_gb} GB` : ""}
              </span>
            </div>
          ))}
          <div className="sys-kv">
            <MemoryStick size={15} />
            <span className="sys-k">{info.ram_gb} GB RAM</span>
          </div>
          {info.disks.map((d, i) => (
            <div key={i} className="sys-kv">
              <HardDrive size={15} />
              <span className="sys-k">
                {d.name} · {d.size_gb} GB · {d.media === "SSD" ? "SSD" : d.media}/{d.bus}
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
          <li className="ok">
            <span className="see-dot ok" />
            {t.seeGame}
          </li>
        </ul>
      </section>
    </div>
  );
}
