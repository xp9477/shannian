import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shannian-e2e-"));
const port = process.env.E2E_PORT || "18789";

const child = spawn(process.execPath, ["apps/api/dist/index.js"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: port,
    DATA_DIR: dataDir,
    WEB_DIST: path.join(repoRoot, "apps/web/dist"),
    COOKIE_SECURE: "false",
    SETUP_TOKEN: "playwright-setup-token",
    SETTINGS_ENCRYPTION_KEY: "playwright-test-key-32-characters-minimum",
  },
  stdio: "inherit",
});

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
}

process.once("SIGTERM", () => stop("SIGTERM"));
process.once("SIGINT", () => stop("SIGINT"));

child.once("error", (error) => {
  console.error("[e2e-server] failed to start", error);
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(1);
});

child.once("exit", (code, signal) => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (signal && !stopping) {
    console.error(`[e2e-server] API exited from ${signal}`);
  }
  process.exit(stopping ? 0 : code ?? 1);
});
