import React from "react";
import ReactDOM from "react-dom/client";
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

installNativeBehavior();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>,
);
