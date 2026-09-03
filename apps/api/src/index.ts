import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { initDb, sqlite } from "./db/index.js";
import { announceSetupToken } from "./lib/setup-token.js";
import { migrateSecretSettingsEncryption } from "./lib/settings.js";
import { enrichCard } from "./services/cards.js";
import {
  startEnrichmentWorker,
  stopEnrichmentWorker,
} from "./services/enrichment-queue.js";
import { recoverInterruptedXImport } from "./services/import/x-import-job.js";

initDb();
migrateSecretSettingsEncryption();
const initialized = sqlite
  .prepare("SELECT 1 FROM settings WHERE key = 'password_hash'")
  .get();
if (!initialized) {
  announceSetupToken();
}
await recoverInterruptedXImport();
startEnrichmentWorker(enrichCard);

const app = createApp();
const port = Number(process.env.PORT || 8787);
const hostname = process.env.LISTEN_HOST?.trim() || "127.0.0.1";
console.log(`闪念 API listening on http://${hostname}:${port}`);
const server = serve({ fetch: app.fetch, port, hostname });

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal}: stop accepting new requests`);
  const forceTimer = setTimeout(() => process.exit(1), 10_000);
  forceTimer.unref();
  const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.all([serverClosed, stopEnrichmentWorker(8_000)]);
  try {
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    sqlite.close();
  } finally {
    clearTimeout(forceTimer);
    process.exit(0);
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
