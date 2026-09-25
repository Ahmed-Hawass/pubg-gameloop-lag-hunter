// useTweaks.ts — the gaming-switch state family: live positions, the
// lightweight tweak_states read, and the optimistic flip. One instance
// serves one mounted section (gaming and storage details never mount
// together, and every mount re-reads live truth, so instances can never
// disagree). The generation guard and the synchronous busy ref are the
// same stale-read protection the single-file view relied on.

import { useCallback, useRef, useState } from "react";
import {
  api,
  notifyFeatureStateChanged,
  type RowState,
} from "../../bridge";
import { errorDialog } from "../../errors";
import { useLang } from "../../i18n";

export function useTweaks(failNotice: (body: string | null) => void) {
  const { t } = useLang();
  /** optimistic switch positions: flip instantly on click; restored to the
      verified live truth after the write settles (and on every fresh read) */
  const [dvrOn, setDvrOn] = useState<boolean | null>(null);
  const [ssOn, setSsOn] = useState<boolean | null>(null);
  const [gameModeOn, setGameModeOn] = useState<boolean | null>(null);
  /** tri-state rows (on/off/disabled-with-reason/hidden) for preconditions
      the user can fix — "hidden" never reaches the render below */
  const [fsoState, setFsoState] = useState<RowState>("hidden");
  const [gpuState, setGpuState] = useState<RowState>("hidden");
  /** power plan row: On = High performance active; Off = present or
      restorable; Hidden = Ultimate active or S0-only firmware */
  const [powerState, setPowerState] = useState<RowState>("hidden");
  const [wgcOn, setWgcOn] = useState<boolean | null>(null);
  const [mouseOn, setMouseOn] = useState<boolean | null>(null);
  const [tweakBusy, setTweakBusy] = useState(false);
  /** the busy gate as a REF (the Checks/Processes pattern): two clicks in
      the same tick both read a stale `false` from state — the ref is
      synchronous, so the second click is refused immediately */
  const tweakBusyRef = useRef(false);
  /** read generation: bumped on every flip start. A reload that STARTED
      before the current generation applies nothing on completion — it
      read the pre-flip truth and would paint it over the verified
      result (the ON-bounce seen on the slow power row: UAC + powercfg
      leave seconds for a stale read to land late). */
  const genRef = useRef(0);
  /** true once a fresh read has landed (sections render real data
      instead of a dead shell); a failed read carries an honest body */
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** every toggle in one table: how to read the switch from the live
      statuses, how to move it, and the registry value each direction
      writes. Adding a tweak = one row here + one SwitchRow in the section.
      The Record annotation keeps the table complete: dropping a TweakId
      row is a build error, not a silent gap. */
  interface TweakRow {
    goal: (on: boolean) => 0 | 1;
    set: (v: boolean) => void;
    get: () => boolean | null;
  }
  const TWEAKS: Record<TweakId, TweakRow> = {
    dvr: {
      goal: (on: boolean): 0 | 1 => (on ? 0 : 1), // ON = recording off
      set: setDvrOn,
      get: () => dvrOn,
    },
    storagesense: {
      goal: (on: boolean): 0 | 1 => (on ? 1 : 0), // ON = cleanup on
      set: setSsOn,
      get: () => ssOn,
    },
    gamemode: {
      goal: (on: boolean): 0 | 1 => (on ? 1 : 0), // ON = mode on
      set: setGameModeOn,
      get: () => gameModeOn,
    },
    fso: {
      goal: (on: boolean): 0 | 1 => (on ? 1 : 0), // ON = optimizations disabled
      set: (v: boolean) => setFsoState(v ? "on" : "off"),
      // only on/off are flippable — disabled/hidden never reach the
      // button (disabled renders greyed, hidden renders nothing)
      get: () => (fsoState === "on" ? true : fsoState === "off" ? false : null),
    },
    gpupref: {
      goal: (on: boolean): 0 | 1 => (on ? 1 : 0), // ON = high-performance preferred
      set: (v: boolean) => setGpuState(v ? "on" : "off"),
      get: () => (gpuState === "on" ? true : gpuState === "off" ? false : null),
    },
    powerplan: {
      goal: (on: boolean): 0 | 1 => (on ? 1 : 0), // ON = High performance active
      set: (v: boolean) => setPowerState(v ? "on" : "off"),
      // only on/off are flippable — hidden never reaches the render below.
      // The flip runs elevated (one UAC per press); a refused prompt rolls
      // back silently, a post-consent failure shows the notice.
      get: () => (powerState === "on" ? true : powerState === "off" ? false : null),
    },
    windowedopt: {
      goal: (on: boolean): 0 | 1 => (on ? 1 : 0), // ON = optimizations on
      set: setWgcOn,
      get: () => wgcOn,
    },
    mouse: {
      goal: (on: boolean): 0 | 1 => (on ? 1 : 0), // ON = precision off
      set: setMouseOn,
      get: () => mouseOn,
    },
  };

  /** fresh switch positions, live from the registry: Windows is the
      single source of truth, so every entry point (open the details page
      / window focus) re-reads live. The read is tweak_states (a handful
      of registry values, microseconds), never the full system_checks
      batch whose rows this page does not display. */
  const reloadSwitches = async () => {
    // generation at START: if a flip begins while this read is in flight,
    // the completion below applies nothing (stale truth must never paint
    // over an optimistic switch, let alone a verified one)
    const gen = genRef.current;
    try {
      const s = await api.tweakStates();
      if (gen !== genRef.current) return;
      setDvrOn(!s.game_dvr_enabled);
      setSsOn(s.storage_sense);
      setGameModeOn(s.game_mode);
      setFsoState(s.fso_disabled);
      setWgcOn(s.windowed_game_opt);
      setGpuState(s.gpu_high_perf);
      setPowerState(s.power_high_perf);
      setMouseOn(s.mouse_accel_off);
      setLoadError(null);
    } catch (e) {
      // same staleness rule for the error surface: a failed pre-flip read
      // must not raise an error page over a flip that already settled
      if (gen !== genRef.current) return;
      const raw = typeof e === "string" ? e : String(e);
      setLoadError(t.dialog.unknownErrorBody(raw));
    } finally {
      if (gen === genRef.current) setReady(true);
    }
  };

  /** generic flip: optimistic move, explicit write both directions,
      verified live truth settles the final position. A verified result IS
      the fresh truth (the engine re-read the registry to confirm it), so
      no full reload after a click — the heavy batch refresh stays at its
      real entry points: opening the view and window focus. */
  const flipTweak = async (id: TweakId, on: boolean) => {
    const tweak = TWEAKS[id];
    // the REF gate: synchronous, so a double-click in one tick cannot slip
    // two writes through (state read was async and both saw `false`)
    if (tweakBusyRef.current) return;
    const before = tweak.get();
    if (before === null) return; // feature unavailable or not read yet
    tweakBusyRef.current = true;
    genRef.current += 1; // any read older than this is stale on arrival
    tweak.set(on); // optimistic: the switch answers instantly
    setTweakBusy(true);
    try {
      const res = await api.setTweak(id, tweak.goal(on));
      if (!res.verified) {
        tweak.set(before); // roll back to the truth we knew
        failNotice(t.tweakFailed);
        return;
      }
      notifyFeatureStateChanged();
      // verified: the switch stays where the optimistic move put it —
      // the engine confirmed the registry holds exactly this state now
    } catch (e) {
      tweak.set(before);
      const raw = typeof e === "string" ? e : String(e);
      // a refused elevation is a choice, not a failure: roll back silently
      // (same exact-"cancelled" contract as the update flow — a message
      // merely containing the word still counts as a real error)
      if (raw === "cancelled") return;
      failNotice(
        errorDialog(raw, t.errors, {
          somethingWrong: t.dialog.somethingWrong,
          scanNeedsGame: t.dialog.scanNeedsGame,
          scanNeedsGameBody: t.dialog.scanNeedsGameBody,
          unknownErrorBody: t.dialog.unknownErrorBody,
        }).body,
      );
    } finally {
      tweakBusyRef.current = false;
      setTweakBusy(false);
    }
  };

  /** synchronous busy probe for focus-storm guards (state would lag a tick) */
  const isBusy = useCallback(() => tweakBusyRef.current, []);

  return {
    dvrOn,
    ssOn,
    gameModeOn,
    fsoState,
    gpuState,
    powerState,
    wgcOn,
    mouseOn,
    tweakBusy,
    ready,
    loadError,
    reloadSwitches,
    flipTweak,
    isBusy,
  };
}

export type TweakId = "dvr" | "storagesense" | "gamemode" | "fso" | "gpupref" | "powerplan" | "windowedopt" | "mouse";
