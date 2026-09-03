import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shannian-queue-test-"));
const previousDataDir = process.env.DATA_DIR;
const previousConcurrency = process.env.ENRICH_CONCURRENCY;
process.env.DATA_DIR = temporaryDataDir;
process.env.ENRICH_CONCURRENCY = "2";

const { initDb, sqlite } = await import("../db/index.js");
const {
  enqueueEnrichmentJob,
  getEnrichmentQueueStats,
  startEnrichmentWorker,
  stopEnrichmentWorker,
} = await import("./enrichment-queue.js");

initDb();

function insertCard(id: string, status: "ready" | "pending" = "ready"): void {
  const timestamp = Date.now();
  sqlite
    .prepare(
      `INSERT INTO cards (
        id, status, fetch_status, ai_status, created_at, updated_at
      ) VALUES (?, 'inbox', ?, ?, ?, ?)`
    )
    .run(
      id,
      status === "pending" ? "pending" : "done",
      status === "pending" ? "pending" : "done",
      timestamp,
      timestamp
    );
}

async function eventually(
  condition: () => boolean,
  message: string,
  timeoutMs = 4_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

test("durable enrichment queue deduplicates, honours concurrency, retries, and recovers", async () => {
  try {
    insertCard("dedup");
    enqueueEnrichmentJob("dedup");
    enqueueEnrichmentJob("dedup", { force: true });
    const deduped = sqlite
      .prepare("SELECT force, version FROM enrichment_jobs WHERE card_id = ?")
      .get("dedup") as { force: number; version: number };
    assert.equal(deduped.force, 1);
    assert.equal(deduped.version, 2);

    for (const id of ["parallel-1", "parallel-2", "parallel-3"]) {
      insertCard(id);
      enqueueEnrichmentJob(id);
    }

    let active = 0;
    let maximumActive = 0;
    const completed = new Set<string>();
    startEnrichmentWorker(async (cardId, options) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 80));
      active -= 1;
      completed.add(`${cardId}:${options.force}`);
    });
    await eventually(
      () => completed.size === 4,
      "deduplicated and parallel work should finish"
    );
    assert.ok(maximumActive <= 2, `saw ${maximumActive} concurrent jobs`);
    assert.ok(completed.has("dedup:true"));
    assert.deepEqual(getEnrichmentQueueStats(), {
      queued: 0,
      running: 0,
      failed: 0,
      oldestQueuedAt: null,
    });
    await stopEnrichmentWorker();

    insertCard("retry");
    enqueueEnrichmentJob("retry");
    let runs = 0;
    startEnrichmentWorker(async (cardId) => {
      if (cardId !== "retry") return;
      runs += 1;
      if (runs === 1) throw new Error("transient failure");
    });
    await eventually(
      () => {
        const row = sqlite
          .prepare("SELECT attempts, status FROM enrichment_jobs WHERE card_id = 'retry'")
          .get() as { attempts: number; status: string } | undefined;
        return row?.attempts === 1 && row.status === "queued";
      },
      "first failed attempt should remain queued with retry metadata"
    );
    // Do not wait for real exponential backoff in a test; move only this test
    // job to now and let the regular worker claim it on its next poll.
    sqlite
      .prepare("UPDATE enrichment_jobs SET available_at = ? WHERE card_id = 'retry'")
      .run(Date.now());
    await eventually(() => runs === 2, "transient failure should retry");
    await eventually(
      () => !sqlite.prepare("SELECT 1 FROM enrichment_jobs WHERE card_id = 'retry'").get(),
      "successful retry should acknowledge the job"
    );
    await stopEnrichmentWorker();

    insertCard("interrupted");
    insertCard("pending-after-restart", "pending");
    const timestamp = Date.now();
    sqlite
      .prepare(
        `INSERT INTO enrichment_jobs (
          card_id, status, force, version, attempts, available_at,
          locked_at, last_error, created_at, updated_at
        ) VALUES ('interrupted', 'running', 0, 7, 2, ?, ?, NULL, ?, ?)`
      )
      .run(timestamp, timestamp, timestamp, timestamp);

    const recovered = new Set<string>();
    startEnrichmentWorker(async (cardId) => {
      recovered.add(cardId);
    });
    await eventually(
      () => recovered.has("interrupted") && recovered.has("pending-after-restart"),
      "startup should reclaim running jobs and enqueue pending cards"
    );
    await eventually(
      () => getEnrichmentQueueStats().queued === 0 && getEnrichmentQueueStats().running === 0,
      "recovered work should be acknowledged"
    );
  } finally {
    await stopEnrichmentWorker();
    sqlite.close();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousConcurrency === undefined) delete process.env.ENRICH_CONCURRENCY;
    else process.env.ENRICH_CONCURRENCY = previousConcurrency;
    fs.rmSync(temporaryDataDir, { recursive: true, force: true });
  }
});
