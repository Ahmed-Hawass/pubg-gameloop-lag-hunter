// ToolsView.tsx — one card per area (Gaming tweaks, Storage), each opening
// its own details section. A switch MIRRORS THE LIVE RESULT of its named
// action (ON = the action holds right now, whoever made it hold), so manual
// changes outside the app appear on the next fresh read. Sections own their
// reads and their state (GamingSection, StorageSection); this shell only
// routes cards and deep-links and owns the two shared dialogs (hint,
// failed-write notice). The sweep and page file editor live under storage.

import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Dialog, MODAL_OPEN_EVENT, APP_DIALOG_OPEN_EVENT } from "../components/components";
import { api } from "../bridge";
import type { Notice } from "../errors";
import { useLang } from "../i18n";
import { GamingSection } from "./tools/GamingSection";
import { StorageSection } from "./tools/StorageSection";
import { summarizeTweaks } from "./tools/summary";
import { useSpotTheme } from "./tools/useSpotTheme";
import spotTweaksDark from "../assets/spot-system-tweaks-dark.svg?url";
import spotTweaksLight from "../assets/spot-system-tweaks-light.svg?url";
import spotStorageDark from "../assets/spot-storage-dark.svg?url";
import spotStorageLight from "../assets/spot-storage-light.svg?url";

export function ToolsView(props: {
  active: boolean;
  /** health-card deep-link target (a gaming row id, or "pagefile" for
      the Storage editor): one-shot, cleared by the landing section once
      it finishes — same contract as the Reports openId */
  toolOpenId: string | null;
  onToolOpened: () => void;
  /** reports cleanup activity to the shell (the exit confirm needs it) */
  onCleaningChange?: (active: boolean) => void;
}) {
  const { active, toolOpenId, onToolOpened, onCleaningChange } = props;
  const { t } = useLang();
  const spotTheme = useSpotTheme();
  /** which card's details are open (the landing cards need no data) */
  const [openCard, setOpenCard] = useState<"gaming" | "storage" | null>(null);
  /** failed-write notice (null = no notice) */
  const [notice, setNotice] = useState<Notice | null>(null);
  /** background-note dialog behind a row's (?) button (null = closed).
      The same unified Dialog as the failed-write notice: one modal surface,
      so the two can never stack (a flip needs a click, impossible behind
      an open modal). */
  const [hint, setHint] = useState<{ title: string; body: string } | null>(null);

  /** landing badge math (null = unread yet or unreadable: the card
      shows no badge rather than a guessed one; the details page owns
      its own read and never waits on this) */
  const [summary, setSummary] = useState<{ shown: number; on: number } | null>(null);

  /** background note behind a row's (?) button: title + body into the one
      shared Dialog below */
  const showHint = (title: string, body: string) => setHint({ title, body });

  // landing badge: one cheap in-process read while the cards show (and a
  // refresh every return from the details, so flips land on the badge).
  // Silent failure: a badge that cannot be read is hidden, never an
  // error on a page whose job is only routing.
  useEffect(() => {
    if (!active || openCard) return;
    let live = true;
    void api
      .tweakStates()
      .then((s) => {
        if (live) setSummary(summarizeTweaks(s));
      })
      .catch(() => {
        if (live) setSummary(null);
      });
    return () => {
      live = false;
    };
  }, [active, openCard]);

  // deep-link: a health card jumps here (DVR to the GAMING page, the
  // page file to the STORAGE section). The link opens the right page
  // first; the section's landing effect scrolls once data arrives.
  useEffect(() => {
    if (!toolOpenId) return;
    const card = toolOpenId === "pagefile" ? "storage" : "gaming";
    if (openCard !== card) setOpenCard(card);
    // one-shot per link arrival, like the Reports openId effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolOpenId]);

  // a dialog mounting under a parked cursor never fires mouseleave — tell
  // every tooltip to hide the moment ours opens (same signal as the shell)
  useEffect(() => {
    if (notice || hint) {
      window.dispatchEvent(new Event(MODAL_OPEN_EVENT));
    }
  }, [notice, hint]);

  // one modal surface, app-wide: if the App-level dialog (gameloop
  // closed, an advice, the exit confirm) opens while one of ours is up,
  // ours yields instead of stacking two overlays where one Escape closes
  // both. The notice and hint are informational. (Section confirms yield
  // through their own listeners, next to their dialogs.)
  useEffect(() => {
    if (!notice && !hint) return;
    const onAppDialog = () => {
      setNotice(null);
      setHint(null);
    };
    window.addEventListener(APP_DIALOG_OPEN_EVENT, onAppDialog);
    return () => window.removeEventListener(APP_DIALOG_OPEN_EVENT, onAppDialog);
  }, [notice, hint]);

  if (openCard) {
    return (
      <div className="tools">
        <button className="back-btn" onClick={() => setOpenCard(null)}>
          <ChevronLeft size={16} />
          {t.toolsBack}
        </button>
        {openCard === "gaming" ? (
          <GamingSection
            active={active}
            linkTarget={toolOpenId}
            onLinkDone={onToolOpened}
            showHint={showHint}
            failNotice={setNotice}
          />
        ) : (
          <StorageSection
            active={active}
            linkTarget={toolOpenId}
            onLinkDone={onToolOpened}
            showHint={showHint}
            failNotice={setNotice}
            onCleaningChange={onCleaningChange}
          />
        )}
        {/* background note behind a row's (?) button — the same unified
            Dialog as the failed-write notice below (one modal surface) */}
        {hint ? (
          <Dialog
            title={hint.title}
            body={hint.body}
            kind="notice"
            okLabel={t.dialog.ok}
            onClose={() => setHint(null)}
          />
        ) : null}
        {/* failed write — the unified Dialog, notice only (the flip itself
            is the consent, there is no confirm step) */}
        {notice ? (
          <Dialog
            title={notice.title}
            body={notice.body}
            kind="notice"
            okLabel={t.dialog.ok}
            onClose={() => setNotice(null)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="tools">
      {/* no intro paragraph: it duplicated the card description below
          almost verbatim — the card carries the meaning alone */}
      <div className="tools-grid">
        <button className="card tool-card" onClick={() => setOpenCard("gaming")}>
          <img
            className="tool-spot"
            src={spotTheme === "light" ? spotTweaksLight : spotTweaksDark}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <span className="tool-title-row">
            <span className="tool-title">{t.toolGamingTweaks}</span>
          </span>
          <span className="tool-desc">{t.toolGamingTweaksDesc}</span>
          {summary ? (
            <span className={`badge check-badge tool-badge ${summary.on === summary.shown ? "ok" : "warn"}`}>
              {t.toolBadgeOptimized(summary.on, summary.shown)}
            </span>
          ) : null}
        </button>
        <button className="card tool-card" onClick={() => setOpenCard("storage")}>
          <img
            className="tool-spot"
            src={spotTheme === "light" ? spotStorageLight : spotStorageDark}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <span className="tool-title-row">
            <span className="tool-title">{t.toolStorage}</span>
          </span>
          <span className="tool-desc">{t.toolStorageDesc}</span>
        </button>
      </div>
    </div>
  );
}
