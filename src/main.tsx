import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LanguageProvider, useLang } from "./i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installNativeBehavior } from "./webBehavior";
import { api, logFrontendError, setWebviewZoom, showMainWindow } from "./bridge";
// fonts: subset + base64-inlined (Google Sans latin, Cairo arabic) - first in
// the import order so every style that follows resolves against loaded faces;
// no fontsource fetch, no first-paint swap
import "./styles/fonts/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/components.css";
import "./styles/views.css";
import "./styles/reports.css";
import "./styles/pages.css";
import "./styles/welcome.css";
import appIcon from "./assets/app-icon.png";

installNativeBehavior();

// last-resort crash reporting: a React render failure on a user machine
// otherwise leaves zero traces (the window just stays hidden). The
// listeners themselves never throw (fire-and-forget invoke), so they
// cannot loop on their own failure. Diagnostic only - the UI itself
// stays exactly as it was.
window.addEventListener("error", (ev) => {
  void logFrontendError(`error: ${ev.message} @${ev.filename}:${ev.lineno}`).catch(() => {});
});
window.addEventListener("unhandledrejection", (ev) => {
  void logFrontendError(`rejection: ${String(ev.reason)}`).catch(() => {});
});

// apply the saved UI zoom as early as the theme seed: the read races
// the first-paint reveal above, so non-100% users see at most one
// flipped frame (same honesty as the contradicting-theme case below -
// unavoidable without a synchronous bridge, splash covers the window).
void api
  .getSettings()
  .then((s) => setWebviewZoom((s.ui_zoom_pct ?? 100) / 100))
  .catch(() => {});

// seed the theme attribute BEFORE the first React paint: the boot splash
// is dark-only, and the app's own default ("auto") matched the OS here
// means the saved light/dark user sees at most a one-frame auto→saved
// flip once settings land. Seeding the OS answer now makes the common
// cases (auto, or saved == OS) flash-free; a saved theme that CONTRADICTS
// the OS still flips after the settings IPC (unavoidable without a
// synchronous bridge, and the window stays on the splash meanwhile).
document.documentElement.dataset.theme = window.matchMedia(
  "(prefers-color-scheme: light)",
).matches
  ? "light"
  : "dark";

// reveal on FIRST PAINT, not full load: index.html already paints the
// static splash during parse (this module runs after it), so showing now
// puts branded content on screen while React + the settings IPC gates
// resolve behind it. window "load" would wait for every resource instead.
// Rust keeps an 8s safety net (see lib.rs) if we never get here.
requestAnimationFrame(() => {
  void showMainWindow().catch(() => {});
});

// warm the app icon early: the <img> tags (titlebar/welcome/about) only
// mount after the settings IPC gate, so without this the fetch+decode
// starts seconds in. Same hashed URL Vite emits for the views - one
// network entry, decoded ahead of first paint.
const iconPreload = new Image();
iconPreload.src = appIcon;
iconPreload.decode().catch(() => {});

/** The render-time crash boundary. It sits INSIDE the language provider
 *  so its fallback speaks the user's language; a render failure used to
 *  unmount the whole tree and leave a blank window with nothing but a
 *  line in the backend log. */
function CrashBoundary(props: { children: React.ReactNode }) {
  const { t } = useLang();
  return (
    <ErrorBoundary title={t.crashTitle} body={t.crashBody} reloadLabel={t.crashReload}>
      {props.children}
    </ErrorBoundary>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <CrashBoundary>
        <App />
      </CrashBoundary>
    </LanguageProvider>
  </React.StrictMode>,
);
