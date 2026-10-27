// SystemView.tsx - the gamer's rig page: spec cards headline one number
// each (max boost, VRAM, refresh), storage rows carry free space and a
// usage meter, then device and system, one copy-all button. Every
// missing value renders "--", never a guess; the copy sheet reuses the
// exact strings on screen (locale-aware, plain text for support pastes).

import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Cpu,
  Gamepad2,
  HardDrive,
  MemoryStick,
  Monitor,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import { Button, Dialog, EmptyState } from "../components/components";
import { PageIntro } from "../components/sections";
import { api, type SystemInfo } from "../bridge";
import { toErrorBody } from "../errors";
import { useLang } from "../i18n";
import type { Locale } from "../locales/en";

/** empty backend strings read as the honest placeholder */
function text(v: string): string | null {
  const s = v.trim();
  return s === "" ? null : s;
}

/** short display name for a CPU ("Intel(R) Core(TM) i7-6820HQ CPU @
    2.70GHz" to "Intel Core i7-6820HQ"): trademarks and the clock suffix
    carry no identity, and the headline already shows the frequency. */
export function shortCpuName(name: string): string {
  return name
    .replace(/\(R\)|\(TM\)/gi, "")
    .split(" CPU @")[0]
    .replace(/\s+/g, " ")
    .trim();
}

/** one bus/media tag for a disk row ("NVMe", "SATA HDD"): NVMe implies
    solid-state on its own, otherwise bus plus media unless they repeat.
    "Unspecified" and blanks read as unknown and drop out, never print. */
export function diskKindLabel(media: string, bus: string): string {
  const parts = [bus, media]
    .map((s) => s.trim())
    .filter((s) => s !== "" && s.toLowerCase() !== "unspecified")
    .filter(
      (s, i, all) => all.findIndex((o) => o.toLowerCase() === s.toLowerCase()) === i,
    );
  if (parts.length === 0) return "";
  if (parts[0].toLowerCase() === "nvme") return "NVMe";
  return parts.join(" ");
}

/** used percent from size and free (null when free is unknown, clamped
    to an honest 0-100: firmware rounding can push either edge over). */
export function diskUsedPct(sizeGb: number, freeGb: number | null): number | null {
  if (freeGb == null || !(sizeGb > 0)) return null;
  return Math.min(100, Math.max(0, Math.round(((sizeGb - freeGb) / sizeGb) * 100)));
}

/** critical-full threshold: at 90% used the meter turns red, mirroring
    Windows Explorer's own low-space red bar (pagefile growth, update
    staging, and GameLoop temp all need that headroom). No yellow band:
    a 75%-used disk is healthy, and painting it warn would cry wolf. */
const DISK_CRIT_USED_PCT = 90;

/** meter tone for a known used percent: green normally, red past the
    critical-full threshold. The amount carries the meaning, the tone
    only shouts when action is due. */
export function diskMeterTone(pct: number): "ok" | "crit" {
  return pct >= DISK_CRIT_USED_PCT ? "crit" : "ok";
}

export function SystemView() {
  const { t } = useLang();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
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
      setError(toErrorBody(e, t));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // first data. A transient PowerShell failure used to leave this tab
  // dead until app restart (single mount-time fetch, keep-alive tab, no
  // retry path) - now the error state carries a retry button and a
  // window-focus re-read.
  useEffect(() => {
    void load();
    // mount-time fetch only: the retry button and focus handler below
    // own every later attempt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!error) return;
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // load re-resolves the fresh locale through its closure on every
    // focus fire - its identity is not part of the subscription contract
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  // copy-all: the exact on-screen strings as plain lines (locale-aware),
  // clipboard first with a notice fallback (never a silent dead button)
  const copyTimerRef = useRef<number | null>(null);
  const copyAll = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(specSheet(info, t));
      setCopied(true);
      // one copied flash at a time: a second click restarts the window
      // instead of leaving two timers racing to clear it
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null;
        setCopied(false);
      }, 1500);
    } catch {
      setCopyFailed(true);
    }
  };

  // and the flash timer never outlives the page: unmount clears it
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  if (error) {
    return (
      <div className="sys">
        <PageIntro
          id="system"
          headerTitle={t.system}
          headerSub={t.systemScope}
          cardTitle={t.introSystemTitle}
          cardBody={t.introSystemBody}
        />
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
        <PageIntro
          id="system"
          headerTitle={t.system}
          headerSub={t.systemScope}
          cardTitle={t.introSystemTitle}
          cardBody={t.introSystemBody}
        />
        <EmptyState icon={<RotateCw size={18} />} title={t.loading} hint="" spin />
      </div>
    );
  }

  const gpu = info.gpus[0] ?? null;
  const cpuName = text(info.cpu.name);
  const gpuName = gpu && text(gpu.name) ? gpu.name : null;
  const bounds =
    info.display.width && info.display.height
      ? `${info.display.width}x${info.display.height}`
      : null;

  return (
    <div className="sys">
      {/* standing page header plus the one-shot card below it (the
          header keeps the tab name like health and processes; the card
          keeps the friendly title) */}
      <PageIntro
        id="system"
        headerTitle={t.system}
        headerSub={t.systemScope}
        cardTitle={t.introSystemTitle}
        cardBody={t.introSystemBody}
      />
      {/* the rig: four spec cards, each headlining one number */}
      <section className="sys-section">
        <h3 className="sys-title">{t.yourRig}</h3>
        <div className="spec-grid">
          <div className="card spec-card">
            <span className="spec-head">
              <span className="icon-tile icon-func">
                <Cpu size={15} />
              </span>
              {t.specCpu}
            </span>
            <span className="spec-value num">
              {info.cpu.max_mhz ? `${(info.cpu.max_mhz / 1000).toFixed(2)} GHz` : "--"}
            </span>
            <span className="spec-sub">
              {info.cpu.cores != null && info.cpu.threads != null
                ? `${info.cpu.cores} ${t.specCores} · ${info.cpu.threads} ${t.specThreads}`
                : "--"}
            </span>
            <span className="spec-more" title={cpuName ?? undefined}>
              {cpuName ? shortCpuName(cpuName) : "--"}
            </span>
          </div>
          <div className="card spec-card">
            <span className="spec-head">
              <span className="icon-tile icon-func">
                <Gamepad2 size={15} />
              </span>
              {t.specGpu}
            </span>
            <span className="spec-value num">
              {gpu?.vram_gb ? `${gpu.vram_gb} ${t.gbUnit}` : "--"}
            </span>
            <span className="spec-sub">{gpu?.vram_gb ? t.specDedicated : "--"}</span>
            <span className="spec-more" title={gpuName ?? undefined}>
              {gpuName ?? "--"}
            </span>
          </div>
          <div className="card spec-card">
            <span className="spec-head">
              <span className="icon-tile icon-func">
                <MemoryStick size={15} />
              </span>
              {t.specRam}
            </span>
            <span className="spec-value num">
              {info.ram.total_gb > 0 ? `${Math.round(info.ram.total_gb)} ${t.gbUnit}` : "--"}
            </span>
            <span className="spec-sub">{info.ram.mem_type ?? "--"}</span>
            <span className="spec-sub">
              {info.ram.speed_mhz ? `${t.specSpeedLabel}: ${info.ram.speed_mhz} MHz` : "--"}
            </span>
          </div>
          <div className="card spec-card">
            <span className="spec-head">
              <span className="icon-tile icon-func">
                <Monitor size={15} />
              </span>
              {t.specDisplay}
            </span>
            <span className="spec-value num">
              {info.display.refresh_hz ? `${info.display.refresh_hz} Hz` : "--"}
            </span>
            <span className="spec-sub">{bounds ?? "--"}</span>
            <span className="spec-sub">
              {info.display.scale_pct
                ? `${t.specScaleLabel}: ${info.display.scale_pct}%`
                : "--"}
            </span>
          </div>
        </div>
      </section>

      {/* storage units: kind, size, and free share one sentence, with
          a usage meter (green, red past 90%) */}
      <section className="sys-section">
        <h3 className="sys-title">{t.storageTitle}</h3>
        <ul className="card spec-list">
          {info.disks.length > 0 ? (
            info.disks.map((d, i) => {
              const kind = diskKindLabel(d.media, d.bus);
              const pct = diskUsedPct(d.size_gb, d.free_gb);
              const sub = [
                kind,
                `${d.size_gb} ${t.gbUnit}`,
                d.free_gb != null ? t.diskFree(d.free_gb) : null,
              ]
                .filter((s) => s != null && s !== "")
                .join(" · ");
              return (
                <li key={i} className="spec-row">
                  <span className="spec-row-main">
                    <span className="icon-tile icon-func">
                      <HardDrive size={15} />
                    </span>
                    <span className="spec-row-text">
                      <span className="spec-row-name">{d.name}</span>
                      <span className="spec-row-sub">{sub}</span>
                      {pct != null ? (
                        <span className="disk-meter" role="img" aria-label={t.diskUsed(pct)}>
                          <span
                            className={`disk-meter-fill${diskMeterTone(pct) === "crit" ? " crit" : ""}`}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="spec-row-val num">
                    {pct != null ? t.diskUsed(pct) : "--"}
                  </span>
                </li>
              );
            })
          ) : (
            <li className="spec-row">
              <span className="spec-row-main">--</span>
            </li>
          )}
        </ul>
      </section>

      {/* device and system */}
      <section className="sys-section">
        <h3 className="sys-title">{t.deviceSystemTitle}</h3>
        <ul className="card spec-list">
          <li className="spec-row">
            <span className="spec-row-main">{t.specModel}</span>
            <span className="spec-row-val">
              {[info.system.manufacturer, info.system.model]
                .map((s) => s.trim())
                .filter((s) => s !== "")
                .join(" ") || "--"}
            </span>
          </li>
          <li className="spec-row">
            <span className="spec-row-main">{t.specOs}</span>
            <span className="spec-row-val">
              {text(info.system.os_caption) ?? "--"}
              {info.system.os_release ? ` ${info.system.os_release}` : ""}
            </span>
          </li>
          <li className="spec-row">
            <span className="spec-row-main">{t.specDirectx}</span>
            <span className="spec-row-val">{info.system.directx}</span>
          </li>
        </ul>
      </section>

      <div className="sys-actions">
        <Button
          label={copied ? t.copiedSpecs : t.copySpecs}
          icon={<Copy size={15} />}
          variant="ghost"
          onClick={() => void copyAll()}
        />
      </div>

      {copyFailed ? (
        <Dialog
          title={t.dialog.somethingWrong}
          body={t.copySpecsFailed}
          kind="notice"
          okLabel={t.dialog.ok}
          onClose={() => setCopyFailed(false)}
        />
      ) : null}
    </div>
  );
}

/** the copy-all sheet: the exact on-screen spec strings as plain lines.
    Pure (same inputs and same helpers as the render above), so the test
    pins parity with what the user sees instead of a second hand-written
    copy. */
export function specSheet(info: SystemInfo, t: Locale): string {
  const dash = "--";
  const gpu = info.gpus[0] ?? null;
  const cpuName = text(info.cpu.name);
  const gpuName = gpu && text(gpu.name) ? gpu.name : null;
  const bounds =
    info.display.width && info.display.height
      ? `${info.display.width}x${info.display.height}`
      : null;
  const lines = [
    `${t.specCpu}: ${
      info.cpu.max_mhz ? `${(info.cpu.max_mhz / 1000).toFixed(2)} GHz` : dash
    } | ${
      info.cpu.cores != null && info.cpu.threads != null
        ? `${info.cpu.cores} ${t.specCores} · ${info.cpu.threads} ${t.specThreads}`
        : dash
    } | ${cpuName ? shortCpuName(cpuName) : dash}`,
    `${t.specGpu}: ${gpu?.vram_gb ? `${gpu.vram_gb} ${t.gbUnit}` : dash} | ${
      gpu?.vram_gb ? t.specDedicated : dash
    } | ${gpuName ?? dash}`,
    `${t.specRam}: ${
      info.ram.total_gb > 0 ? `${Math.round(info.ram.total_gb)} ${t.gbUnit}` : dash
    } | ${info.ram.mem_type ?? dash} | ${
      info.ram.speed_mhz ? `${t.specSpeedLabel}: ${info.ram.speed_mhz} MHz` : dash
    }`,
    `${t.specDisplay}: ${
      info.display.refresh_hz ? `${info.display.refresh_hz} Hz` : dash
    } | ${bounds ?? dash} | ${
      info.display.scale_pct ? `${t.specScaleLabel}: ${info.display.scale_pct}%` : dash
    }`,
    `${t.storageTitle}: ${
      info.disks.length > 0
        ? info.disks
            .map((d) => {
              const kind = diskKindLabel(d.media, d.bus);
              const pct = diskUsedPct(d.size_gb, d.free_gb);
              const sub = [
                kind,
                `${d.size_gb} ${t.gbUnit}`,
                d.free_gb != null ? t.diskFree(d.free_gb) : null,
              ]
                .filter((s) => s != null && s !== "")
                .join(" · ");
              return `${d.name} (${sub}${pct != null ? `, ${t.diskUsed(pct)}` : ""})`;
            })
            .join("; ")
        : dash
    }`,
    `${t.specModel}: ${
      [info.system.manufacturer, info.system.model]
        .map((s) => s.trim())
        .filter((s) => s !== "")
        .join(" ") || dash
    }`,
    `${t.specOs}: ${text(info.system.os_caption) ?? dash}${
      info.system.os_release ? ` ${info.system.os_release}` : ""
    }`,
    `${t.specDirectx}: ${info.system.directx}`,
  ];
  return lines.join("\n");
}
