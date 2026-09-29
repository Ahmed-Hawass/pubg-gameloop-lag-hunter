// StorageSection.tsx — the storage details page: the Storage Sense
// switch, alone for now (the page file and the sweep own their cards).
// More storage features land here. The switch owns its read through
// useTweaks; this shell only gates the first paint.

import { useEffect } from "react";
import { Recycle, RefreshCw, SlidersHorizontal } from "lucide-react";
import { EmptyState } from "../../components/components";
import type { Notice } from "../../errors";
import { useLang } from "../../i18n";
import { SwitchRow } from "./SwitchRow";
import { useTweaks } from "./useTweaks";

export function StorageSection(props: {
  active: boolean;
  showHint: (title: string, body: string) => void;
  failNotice: (notice: Notice | null) => void;
}) {
  const { active, showHint, failNotice } = props;
  const { t } = useLang();
  const tweaks = useTweaks(failNotice);

  useEffect(() => {
    if (!active) return;
    // same no-mid-flip-read rule as the gaming page: the verified result
    // is the truth until it lands
    if (tweaks.isBusy()) return;
    void tweaks.reloadSwitches();
    // the read contract is about this DETAILS page being visible;
    // reload's identity is not part of the subscription contract
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onFocus = () => {
      if (tweaks.isBusy()) return;
      void tweaks.reloadSwitches();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // same as above: reload's identity is not part of the subscription
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!tweaks.ready) {
    // nothing has landed yet: the loading shell, never a dead page
    // and never an error for a read still in flight (a failed read
    // below degrades to an honest error page instead)
    const failed = tweaks.loadError !== null;
    return (
      <div className="check-list">
        <EmptyState
          icon={failed ? <SlidersHorizontal size={18} /> : <RefreshCw size={20} />}
          title={failed ? t.dialog.somethingWrong : t.loading}
          hint={failed ? (tweaks.loadError ?? "") : ""}
          spin={!failed}
        />
      </div>
    );
  }

  return (
    <div className="check-list">
      {tweaks.ssOn !== null ? (
        <SwitchRow
          tweakId="storagesense"
          linked={false}
          on={tweaks.ssOn}
          func={<Recycle size={15} />}
          name={t.tweakSsTitle}
          hintTitle={t.tweakSsTitle}
          hintBody={t.tweakSsHint}
          onHint={showHint}
          busy={tweaks.tweakBusy}
          onFlip={(next) => void tweaks.flipTweak("storagesense", next)}
        />
      ) : null}
    </div>
  );
}
