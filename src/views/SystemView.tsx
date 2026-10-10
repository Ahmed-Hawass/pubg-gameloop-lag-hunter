// SystemView.tsx — the gamer's rig page: spec cards, storage, device and
// system, one copy-all button, then what the tool can see. Every missing
// value renders "--", never a guess; the copy sheet reuses the exact
// strings on screen (locale-aware, plain text for support pastes).

import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Cpu,
  Gamepad2,
  HardDrive,
  MemoryStick,
  Monitor,
  RefreshCw,
} from "lucide-react";
import { Button, Dialog, EmptyState } from "../components/components";
import { api, type SystemInfo } from "../bridge";
import { toErrorBody } from "../errors";
import { useLang } from "../i18n";
import type { Locale } from "../locales/en";

/** empty backend strings read as the honest placeholder */
function text(v: string): string | null {
  const s = v.trim();
  return s === "" ? null : s;
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
  // retry path) — now the error state carries a retry button and a
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
    // focus fire — its identity is not part of the subscription contract
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  // copy-all: the exact on-screen strings as plain lines (locale-aware),
  // clipboard first with a notice fallback (never a silent dead button)
  const copyAll = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(specSheet(info, t));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyFailed(true);
    }
  };

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
        <EmptyState icon={<RefreshCw size={20} />} title={t.loading} hint="" spin />
      </div>
    );
  }

  const gpu = info.gpus[0] ?? null;

  return (
    <div className="sys">
      {/* the rig: four spec cards */}
      <section className="sys-section">
        <h3 className="sys-title">{t.yourRig}</h3>
        <div className="spec-grid">
          <div className="card spec-card">
            <span className="spec-head">
              <Cpu size={15} />
              {t.specCpu}
            </span>
            <span className="spec-name" title={text(info.cpu.name) ?? "--"}>{text(info.cpu.name) ?? "--"}</span>
            <span className="spec-sub">
              {info.cpu.mhz ? `${(info.cpu.mhz / 1000).toFixed(2)} GHz ${t.specBase}` : "--"}
            </span>
            <span className="spec-sub">
              {info.cpu.cores != null && info.cpu.threads != null
                ? `${info.cpu.cores} ${t.specCores} · ${info.cpu.threads} ${t.specThreads}`
                : "--"}
            </span>
          </div>
          <div className="card spec-card">
            <span className="spec-head">
              <Gamepad2 size={15} />
              {t.specGpu}
            </span>
            <span className="spec-name" title={gpu && text(gpu.name) ? gpu.name : "--"}>{gpu && text(gpu.name) ? gpu.name : "--"}</span>
            <span className="spec-sub">
              {gpu?.vram_gb ? `${gpu.vram_gb} ${t.gbUnit} ${t.specDedicated}` : "--"}
            </span>
            <span className="spec-sub">
              {gpu?.driver ? `${t.specDriver} ${gpu.driver}` : "--"}
            </span>
          </div>
          <div className="card spec-card">
            <span className="spec-head">
              <MemoryStick size={15} />
              {t.specRam}
            </span>
            <span className="spec-name">
              {info.ram.total_gb > 0 ? `${info.ram.total_gb} ${t.gbUnit}` : "--"}
            </span>
            <span className="spec-sub">
              {info.ram.mem_type ?? "--"}
              {info.ram.speed_mhz ? ` · ${info.ram.speed_mhz} MHz` : ""}
            </span>
          </div>
          <div className="card spec-card">
            <span className="spec-head">
              <Monitor size={15} />
              {t.specDisplay}
            </span>
            <span className="spec-name">
              {info.display.width && info.display.height
                ? `${info.display.width}x${info.display.height}`
                : "--"}
            </span>
            <span className="spec-sub">
              {info.display.refresh_hz ? `${info.display.refresh_hz} Hz` : "--"}
            </span>
            <span className="spec-sub">
              {info.display.scale_pct ? `${info.display.scale_pct}% ${t.specScale}` : "--"}
            </span>
          </div>
        </div>
      </section>

      {/* storage units */}
      <section className="sys-section">
        <h3 className="sys-title">{t.storageTitle}</h3>
        <ul className="card spec-list">
          {info.disks.length > 0 ? (
            info.disks.map((d, i) => (
              <li key={i} className="spec-row">
                <span className="spec-row-main">
                  <HardDrive size={15} />
                  <span className="spec-row-text">
                    <span className="spec-row-name">{d.name}</span>
                    <span className="spec-row-sub">
                      {d.media}/{d.bus}
                    </span>
                  </span>
                </span>
                <span className="spec-row-val num">
                  {d.size_gb} {t.gbUnit}
                </span>
              </li>
            ))
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
              {info.system.os_release ? ` · ${info.system.os_release}` : ""}
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
    Pure (same inputs as the render above), so the test pins parity with
    what the user sees instead of a second hand-written copy. */
export function specSheet(info: SystemInfo, t: Locale): string {
  const dash = "--";
  const gpu = info.gpus[0] ?? null;
  const lines = [
    `${t.specCpu}: ${text(info.cpu.name) ?? dash} | ${
      info.cpu.mhz ? `${(info.cpu.mhz / 1000).toFixed(2)} GHz ${t.specBase}` : dash
    } | ${
      info.cpu.cores != null && info.cpu.threads != null
        ? `${info.cpu.cores} ${t.specCores} · ${info.cpu.threads} ${t.specThreads}`
        : dash
    }`,
    `${t.specGpu}: ${gpu && text(gpu.name) ? gpu.name : dash} | ${
      gpu?.vram_gb ? `${gpu.vram_gb} ${t.gbUnit} ${t.specDedicated}` : dash
    } | ${gpu?.driver ? `${t.specDriver} ${gpu.driver}` : dash}`,
    `${t.specRam}: ${
      info.ram.total_gb > 0 ? `${info.ram.total_gb} ${t.gbUnit}` : dash
    } | ${info.ram.mem_type ?? dash}${
      info.ram.speed_mhz ? ` · ${info.ram.speed_mhz} MHz` : ""
    }`,
    `${t.specDisplay}: ${
      info.display.width && info.display.height
        ? `${info.display.width}x${info.display.height}`
        : dash
    } | ${info.display.refresh_hz ? `${info.display.refresh_hz} Hz` : dash} | ${
      info.display.scale_pct ? `${info.display.scale_pct}% ${t.specScale}` : dash
    }`,
    `${t.storageTitle}: ${
      info.disks.length > 0
        ? info.disks.map((d) => `${d.name} (${d.media}/${d.bus}, ${d.size_gb} ${t.gbUnit})`).join("; ")
        : dash
    }`,
    `${t.specModel}: ${
      [info.system.manufacturer, info.system.model]
        .map((s) => s.trim())
        .filter((s) => s !== "")
        .join(" ") || dash
    }`,
    `${t.specOs}: ${text(info.system.os_caption) ?? dash}${
      info.system.os_release ? ` · ${info.system.os_release}` : ""
    }`,
    `${t.specDirectx}: ${info.system.directx}`,
  ];
  return lines.join("\n");
}
