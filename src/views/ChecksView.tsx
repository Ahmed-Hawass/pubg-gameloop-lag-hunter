// ChecksView.tsx — read-only environment checks + "take me there" buttons.
// Gently live: power plan / pagefile / battery state can change while the
// user is on this tab (unplugging the charger is the classic case).

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  Info,
  Plug,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Video,
  Zap,
} from "lucide-react";
import { Button, Dialog, EmptyState, IntroCard, dispatchModalOpen, APP_DIALOG_OPEN_EVENT } from "../components/components";
import { api, FEATURE_STATE_CHANGED_EVENT, type SystemChecks } from "../bridge";
import { errorDialog } from "../errors";
import { useLang } from "../i18n";
import { useIntroCard } from "../useIntroCard";

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
  /** one-shot page guidance (replaces the static header line below):
      the smooth-or-stuttering verdict and the one-click fix path.
      Declared with every other hook (never past the error/loading early
      returns): hook order must not shift between renders. Transient
      error/loading headers above keep their own hint line. */
  const intro = useIntroCard("health");

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
      // the locale copy for known backend keys, with the raw message riding
      // along as a technical line only for novel failures
      if (!silent) {
        const raw = typeof e === "string" ? e : String(e);
        setError(
          errorDialog(raw, t.errors, {
            somethingWrong: t.dialog.somethingWrong,
            scanNeedsGame: t.dialog.scanNeedsGame,
            scanNeedsGameBody: t.dialog.scanNeedsGameBody,
            unknownErrorBody: t.dialog.unknownErrorBody,
          }).body,
        );
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
    void load(true, true);
    const timer = window.setInterval(() => void load(true), LIVE_INTERVAL_MS);
    // returning from Windows Settings (after flipping a toggle) refreshes
    // immediately: force pays one PowerShell spawn, skipped while busy
    const onFocus = () => void load(true, true);
    const onFeatureStateChanged = () => void load(true, true);
    window.addEventListener("focus", onFocus);
    window.addEventListener(FEATURE_STATE_CHANGED_EVENT, onFeatureStateChanged);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(FEATURE_STATE_CHANGED_EVENT, onFeatureStateChanged);
    };
    // load reads busyRef/pendingManualRef (refs) and queues itself; its
    // identity is not part of the subscription contract
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // a dialog mounting under a parked cursor never fires mouseleave — tell
  // every tooltip to hide the moment ours opens (same signal as the shell)
  useEffect(() => {
    if (hint) {
      dispatchModalOpen();
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
        <EmptyState icon={<RefreshCw size={20} />} title={t.loading} hint="" spin />
      </div>
    );
  }

  const pagefileText = !checks.pagefile_ok
    ? checks.pagefile_mode === "off"
      ? t.pagefileOff
      : t.pagefileManual(checks.pagefile_mb)
    : t.pagefileAuto;

  const chargerBad = checks.laptop && !checks.on_ac;

  /** one data row per health card: the attention section and the full
      archive render the SAME CheckCard below, so a fix can never drift
      between summary and list (edit once, both follow). */
  type CheckItem = {
    id: string;
    ok: boolean;
    funcIcon: ReactNode;
    name: string;
    state: string;
    hint: { title: string; body: string };
    /** null = read-only card (VT, charger): state text only, no button */
    onOpen: (() => void) | null;
  };
  // power/DVR/page file have an in-app Tools row: stay inside the app
  // and land on it. Without the link, keep the Windows page.
  const openInAppOr = (toolId: string, panel: string) => () => {
    if (onOpenTool) onOpenTool(toolId);
    else void api.openWindowsPanel(panel);
  };
  const items: CheckItem[] = [
    {
      id: "power",
      ok: checks.power_ok,
      funcIcon: <Zap size={15} />,
      name: t.checkPower,
      state: checks.power_ok ? t.powerOk(checks.power_name) : t.powerWarn(checks.power_name),
      hint: { title: t.checkPower, body: t.checkPowerHint },
      onOpen: openInAppOr("powerplan", "power"),
    },
    {
      id: "vt",
      ok: checks.vt_enabled,
      funcIcon: <Cpu size={15} />,
      name: t.checkVt,
      state: checks.vt_enabled ? t.vtOk : t.vtWarn,
      hint: { title: t.checkVt, body: t.checkVtHint },
      onOpen: null,
    },
    {
      id: "dvr",
      ok: !checks.game_dvr_enabled,
      funcIcon: <Video size={15} />,
      name: t.checkDvr,
      state: checks.game_dvr_enabled ? t.dvrWarn : t.dvrOk,
      hint: { title: t.checkDvr, body: t.tweakDvrHint },
      onOpen: openInAppOr("dvr", "gaming-captures"),
    },
    {
      id: "pagefile",
      ok: checks.pagefile_ok,
      funcIcon: <Database size={15} />,
      name: t.checkPagefile,
      state: pagefileText,
      hint: { title: t.checkPagefile, body: t.checkPagefileHint },
      onOpen: openInAppOr("pagefile", "system"),
    },
    // charger lives on laptops only — hidden on desktops, never a
    // placeholder row
    ...(checks.laptop
      ? [
          {
            id: "charger",
            ok: !chargerBad,
            funcIcon: <Plug size={15} />,
            name: t.checkCharger,
            state: chargerBad ? t.chargerWarn : t.chargerOk,
            hint: { title: t.checkCharger, body: t.checkChargerHint },
            onOpen: null,
          } satisfies CheckItem,
        ]
      : []),
  ];
  const warnItems = items.filter((item) => !item.ok);
  const openLabel = onOpenTool ? t.openInTools : t.openSettings;

  return (
    <div className="checks">
      {intro.show ? (
        <IntroCard
          icon={<ShieldCheck size={16} />}
          title={t.introHealthTitle}
          body={t.introHealthBody}
          dismissLabel={t.dialog.dismiss}
          onDismiss={intro.dismiss}
        />
      ) : null}

      {/* one-glance verdict: derived from the five checks above, zero
          backend cost (counts warn cards, nothing more). The re-read is
          a quiet back-button in the banner tail (same control as the
          Tools/Reports back buttons): no box to clash with the fill. */}
      <div className={`health-banner ${warnItems.length === 0 ? "ok" : "warn"}`}>
        {warnItems.length === 0 ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
        <div>
          <div className="hb-title">
            {warnItems.length === 0 ? t.healthAllGood : t.healthNeedsTitle(warnItems.length)}
          </div>
          <div className="hb-sub">{warnItems.length === 0 ? t.healthAllGoodSub : t.healthNeedsSub}</div>
        </div>
        <button
          type="button"
          className="back-btn"
          disabled={busy}
          onClick={() => void load(false, true)}
        >
          <RefreshCw size={14} className={busy ? "spin" : ""} />
          {busy ? t.loading : t.refresh}
        </button>
      </div>
      {/* featured warnings: the same cards as the archive below, repeated
          deliberately (summary + archive, not summary instead of it) */}
      {warnItems.length > 0 ? (
        <section>
          <h3 className="health-section-title">{t.checkWarnBadge}</h3>
          <div className="check-list">
            {warnItems.map((item) => (
              <CheckCard key={item.id} item={item} openLabel={openLabel} onHint={setHint} />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h3 className="health-section-title">{t.healthAllSettings}</h3>
        <div className="check-list">
          {items.map((item) => (
            <CheckCard key={item.id} item={item} openLabel={openLabel} onHint={setHint} />
          ))}
        </div>
      </section>
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

/** one health card: a single compact row (glyph, name, state, badge,
    background note behind the (?) button). The open shortcut renders
    on problem cards only — a healthy card has nowhere to send anyone.
    Featured warnings and archive rows share this card, so the rule can
    never drift between summary and list. */
function CheckCard(props: {
  item: {
    ok: boolean;
    funcIcon: ReactNode;
    name: string;
    state: string;
    hint: { title: string; body: string };
    onOpen: (() => void) | null;
  };
  openLabel: string;
  onHint: (hint: { title: string; body: string }) => void;
}) {
  const { item, openLabel, onHint } = props;
  const { t } = useLang();
  return (
    <div className={`card-sm check-row ${item.ok ? "verdict-ok" : "verdict-warn"}`}>
      <div className="check-top">
        <span className="check-func">{item.funcIcon}</span>
        <span className="check-name">{item.name}</span>
        <span className="check-state">{item.state}</span>
        <span className={`badge check-badge ${item.ok ? "ok" : "warn"}`}>
          {item.ok ? t.checkOkBadge : t.checkWarnBadge}
        </span>
        <button
          type="button"
          className="switch-hint"
          aria-label={item.name}
          onClick={() => onHint(item.hint)}
        >
          <Info size={13} />
        </button>
      </div>
      {!item.ok && item.onOpen ? (
        <button className="row-act check-open" onClick={item.onOpen}>
          {openLabel}
        </button>
      ) : null}
    </div>
  );
}
