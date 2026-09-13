import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { initializePreferences } from "./app/theme/preferences";
import { ThemeProvider } from "./app/theme/theme";
import "./styles.css";
import "./app/theme/theme.css";

initializePreferences();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
