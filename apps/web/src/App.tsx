import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api } from "./lib/api";
import LoginPage from "./pages/LoginPage";
import SetupPage from "./pages/SetupPage";
import HomePage from "./pages/HomePage";
import CardPage from "./pages/CardPage";
import SettingsPage from "./pages/SettingsPage";
import TrashPage from "./pages/TrashPage";
import ImportPage from "./pages/ImportPage";

type Boot =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "login" }
  | { kind: "app" };

export default function App() {
  const [boot, setBoot] = useState<Boot>({ kind: "loading" });
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const status = await api.setupStatus();
        if (!status.initialized) {
          setBoot({ kind: "setup" });
          return;
        }
        try {
          await api.me();
          setBoot({ kind: "app" });
        } catch {
          setBoot({ kind: "login" });
        }
      } catch {
        setBoot({ kind: "login" });
      }
    })();
  }, []);

  if (boot.kind === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-slate-500 dark:text-slate-400">
        加载中…
      </div>
    );
  }

  if (boot.kind === "setup") {
    return (
      <SetupPage
        onDone={() => {
          setBoot({ kind: "app" });
          navigate("/");
        }}
      />
    );
  }

  if (boot.kind === "login") {
    return (
      <LoginPage
        onDone={() => {
          setBoot({ kind: "app" });
          navigate("/");
        }}
      />
    );
  }

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/cards/:id" element={<CardPage />} />
      <Route path="/import" element={<ImportPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/trash" element={<TrashPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
