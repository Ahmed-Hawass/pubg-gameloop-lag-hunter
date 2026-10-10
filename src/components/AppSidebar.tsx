// AppSidebar.tsx — the shell's tab rail, presentational only. App owns
// every piece of state (view, collapsed, update dot); this renders the
// nav and reports clicks back. Extracted from App without behavior
// change so the shell stays readable as advice and dialog logic grows.

import { ChevronsLeft, ChevronsRight, Info } from "lucide-react";
import { Tip } from "./components";
import type { UpdateInfo } from "../bridge";
import type { Locale } from "../locales/en";

export type SidebarView =
  | "monitor"
  | "system"
  | "processes"
  | "checks"
  | "tools"
  | "reports"
  | "settings"
  | "about";

export interface SidebarTab {
  id: Exclude<SidebarView, "about">;
  icon: React.ReactNode;
  label: string;
  beta?: boolean;
}

export function AppSidebar(props: {
  t: Locale;
  tabs: SidebarTab[];
  view: SidebarView;
  collapsed: boolean;
  updateInfo: UpdateInfo | null;
  onSelect: (v: Exclude<SidebarView, "about">) => void;
  onAbout: () => void;
  onToggleSidebar: () => void;
}) {
  const { t, tabs, view, collapsed, updateInfo, onSelect, onAbout, onToggleSidebar } = props;
  return (
    <nav className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="sb-label">{t.menu}</div>
      {tabs.map((tab) => (
        <Tip
          key={tab.id}
          // collapsed rail hides the beta pill: the tooltip
          // carries the signal instead (expanded labels show it)
          text={collapsed ? (tab.beta ? `${tab.label} (${t.toolsBeta})` : tab.label) : ""}
        >
          <button
            className={`focus-ring sb-item ${view === tab.id ? "is-active" : ""}`}
            // the active tab is announced as current (visual
            // is-active styling is invisible to screen readers)
            aria-current={view === tab.id ? "page" : undefined}
            onClick={() => onSelect(tab.id)}
          >
            {tab.icon}
            {!collapsed ? <span>{tab.label}</span> : null}
            {/* beta pill: in-flow label (not the corner update
                dot), hidden with the labels on the collapsed
                rail; remove with the key when v2 goes stable */}
            {!collapsed && tab.beta ? (
              <span className="sb-beta">{t.toolsBeta}</span>
            ) : null}
          </button>
        </Tip>
      ))}

      <Tip text={collapsed ? t.about : ""}>
        <button
          className={`focus-ring sb-item ${view === "about" ? "is-active" : ""}`}
          onClick={onAbout}
        >
          <Info size={17} />
          {!collapsed ? <span>{t.about}</span> : null}
          {/* the update dot: hidden while About itself is open
              (the heading dot carries the signal there — never
              two yellows for one update) */}
          {updateInfo && view !== "about" ? (
            <span
              className="sb-dot"
              // role+label: an aria-label on a plain span is invisible to
              // assistive tech — status announces it politely
              role="status"
              aria-label={t.updateAvailableTitle}
            />
          ) : null}
        </button>
      </Tip>

      {/* spacer pushes the collapse control to the sidebar's floor */}
      <div className="sb-spacer" />

      {/* collapse control — pinned at the very bottom of the sidebar:
          flips direction when collapsed; no tooltip while
          expanded (the visible label says it already) */}
      <Tip text={collapsed ? t.expandMenu : ""}>
        <button
          className="focus-ring sb-collapse"
          onClick={onToggleSidebar}
          aria-label={collapsed ? t.expandMenu : t.collapseMenu}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
          {!collapsed ? <span>{t.collapseMenu}</span> : null}
        </button>
      </Tip>
    </nav>
  );
}
