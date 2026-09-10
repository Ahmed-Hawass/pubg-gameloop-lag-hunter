import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { LanguageProvider } from "./i18n";
import { installNativeBehavior } from "./webBehavior";
// fonts: subset + base64-inlined (Google Sans latin, Cairo arabic) — first in
// the import order so every style that follows resolves against loaded faces;
// no fontsource fetch, no first-paint swap
import "./styles/fonts/fonts.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/components.css";
import "./styles/views.css";
import "./styles/reports.css";
import "./styles/pages.css";
import "./styles/welcome.css";
import appIcon from "./assets/app-icon.png";

installNativeBehavior();

// reveal on FIRST PAINT, not full load: index.html already paints the
// static splash during parse (this module runs after it), so showing now
// puts branded content on screen while React + the settings IPC gates
// resolve behind it. window "load" would wait for every resource instead.
// Rust keeps an 8s safety net (see lib.rs) if we never get here.
requestAnimationFrame(() => {
  void getCurrentWindow()
    .show()
    .catch(() => {});
});

// warm the app icon early: the <img> tags (titlebar/welcome/about) only
// mount after the settings IPC gate, so without this the fetch+decode
// starts seconds in. Same hashed URL Vite emits for the views — one
// network entry, decoded ahead of first paint.
const iconPreload = new Image();
iconPreload.src = appIcon;
iconPreload.decode().catch(() => {});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>,
);
