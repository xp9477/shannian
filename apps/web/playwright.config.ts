import { fileURLToPath } from "node:url";
import { defineConfig } from "playwright/test";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const port = Number(process.env.E2E_PORT || 18789);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // This smoke deliberately validates a fresh first-run database. Retrying
  // against the same webServer would instead land on login and mask the real
  // failure with state left by the first attempt.
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL,
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "node apps/web/e2e/server.mjs",
    cwd: repoRoot,
    env: { E2E_PORT: String(port) },
    url: `${baseURL}/api/health`,
    timeout: 30_000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
