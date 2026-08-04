import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";
import { applyTheme, getThemeMode } from "./lib/theme";

// Default light (design system); honor stored preference
applyTheme(getThemeMode());
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  applyTheme();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="bottom-center"
        richColors
        closeButton
        theme="system"
        toastOptions={{ className: "text-sm" }}
      />
    </BrowserRouter>
  </StrictMode>
);
