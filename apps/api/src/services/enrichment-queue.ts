import { sqlite } from "../db/index.js";

export interface EnrichmentJobOptions {
  force?: boolean;
}

type EnrichmentHandler = (
  cardId: string,
  options: EnrichmentJobOptions
) => Promise<void>;

interface JobRow {
  cardId: string;
  force: number;
  version: number;
  attempts: number;
}

export interface EnrichmentQueueStats {
  queued: number;
  running: number;
  failed: number;
  oldestQueuedAt: number | null;
}

const MAX_ATTEMPTS = 4;
const DEFAULT_CONCURRENCY = 2;
const POLL_INTERVAL_MS = 1_000;

let handler: EnrichmentHandler | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let wakeScheduled = false;
let stopping = false;
let active = 0;

function concurrency(): number {
  const parsed = Number(process.env.ENRICH_CONCURRENCY || DEFAULT_CONCURRENCY);
  if (!Number.isInteger(parsed)) return DEFAULT_CONCURRENCY;
  return Math.max(1, Math.min(parsed, 8));
}

export function enqueueEnrichmentJob(
  cardId: string,
  options: EnrichmentJobOptions = {}
): void {
  const timestamp = Date.now();
  sqlite
    .prepare(
      `INSERT INTO enrichment_jobs (
         card_id, status, force, version, attempts, available_at,
         locked_at, last_error, created_at, updated_at
       ) VALUES (?, 'queued', ?, 1, 0, ?, NULL, NULL, ?, ?)
       ON CONFLICT(card_id) DO UPDATE SET
         version = enrichment_jobs.version + 1,
         force = CASE
           WHEN excluded.force = 1 THEN 1
           ELSE enrichment_jobs.force
         END,
         status = CASE
           WHEN enrichment_jobs.status = 'running' THEN 'running'
           ELSE 'queued'
         END,
         attempts = CASE
           WHEN enrichment_jobs.status = 'running' THEN enrichment_jobs.attempts
           ELSE 0
         END,
         available_at = excluded.available_at,
         last_error = NULL,
         updated_at = excluded.updated_at`
    )
    .run(cardId, options.force ? 1 : 0, timestamp, timestamp, timestamp);
  wakeWorker();
}

function recoverJobs(): void {
  const timestamp = Date.now();
  const transaction = sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE enrichment_jobs
         SET status = 'queued', locked_at = NULL, available_at = ?, updated_at = ?
         WHERE status = 'running'`
      )
      .run(timestamp, timestamp);
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO enrichment_jobs (
           card_id, status, force, version, attempts, available_at,
           locked_at, last_error, created_at, updated_at
         )
         SELECT id, 'queued', 0, 1, 0, ?, NULL, NULL, ?, ?
         FROM cards
         WHERE deleted_at IS NULL
           AND (fetch_status = 'pending' OR ai_status = 'pending')`
      )
      .run(timestamp, timestamp, timestamp);
  });
  transaction();
}

function claimNext(): JobRow | null {
  const claim = sqlite.transaction(() => {
    const row = sqlite
      .prepare(
        `SELECT
           card_id AS cardId,
           force,
           version,
           attempts
         FROM enrichment_jobs
         WHERE status = 'queued' AND available_at <= ?
         ORDER BY available_at ASC, created_at ASC
         LIMIT 1`
      )
      .get(Date.now()) as JobRow | undefined;
    if (!row) return null;
    const timestamp = Date.now();
    const result = sqlite
      .prepare(
        `UPDATE enrichment_jobs
         SET status = 'running', locked_at = ?, updated_at = ?
         WHERE card_id = ? AND status = 'queued' AND version = ?`
      )
      .run(timestamp, timestamp, row.cardId, row.version);
    return result.changes === 1 ? row : null;
  });
  return claim();
}

function finishJob(job: JobRow): void {
  const current = sqlite
    .prepare("SELECT version FROM enrichment_jobs WHERE card_id = ?")
    .get(job.cardId) as { version: number } | undefined;
  if (!current) return;
  if (current.version === job.version) {
    sqlite
      .prepare("DELETE FROM enrichment_jobs WHERE card_id = ? AND version = ?")
      .run(job.cardId, job.version);
    return;
  }
  const timestamp = Date.now();
  sqlite
    .prepare(
      `UPDATE enrichment_jobs
       SET status = 'queued', attempts = 0, locked_at = NULL,
           available_at = ?, updated_at = ?
       WHERE card_id = ?`
    )
    .run(timestamp, timestamp, job.cardId);
}

function failJob(job: JobRow, error: unknown): void {
  const current = sqlite
    .prepare("SELECT version FROM enrichment_jobs WHERE card_id = ?")
    .get(job.cardId) as { version: number } | undefined;
  if (!current) return;

  const timestamp = Date.now();
  if (current.version !== job.version) {
    sqlite
      .prepare(
        `UPDATE enrichment_jobs
         SET status = 'queued', attempts = 0, locked_at = NULL,
             available_at = ?, last_error = NULL, updated_at = ?
         WHERE card_id = ?`
      )
      .run(timestamp, timestamp, job.cardId);
    return;
  }

  const attempts = job.attempts + 1;
  const terminal = attempts >= MAX_ATTEMPTS;
  const backoffMs = Math.min(60_000, 1_000 * 2 ** (attempts - 1));
  const message = error instanceof Error ? error.message : String(error);
  sqlite
    .prepare(
      `UPDATE enrichment_jobs
       SET status = ?, attempts = ?, locked_at = NULL, available_at = ?,
           last_error = ?, updated_at = ?
       WHERE card_id = ? AND version = ?`
    )
    .run(
      terminal ? "failed" : "queued",
      attempts,
      terminal ? timestamp : timestamp + backoffMs,
      message.slice(0, 1_000),
      timestamp,
      job.cardId,
      job.version
    );
}

async function runJob(job: JobRow): Promise<void> {
  active += 1;
  try {
    await handler!(job.cardId, { force: job.force === 1 });
    finishJob(job);
  } catch (error) {
    console.error("[enrichment] worker failure", job.cardId, error);
    try {
      failJob(job, error);
    } catch (persistError) {
      // A full/corrupt database is already surfaced by health checks. Do not
      // additionally turn the detached worker promise into an unhandled
      // rejection; the still-running row will be recovered on restart.
      console.error(
        "[enrichment] could not persist worker failure",
        job.cardId,
        persistError
      );
    }
  } finally {
    active -= 1;
    wakeWorker();
  }
}

function drain(): void {
  wakeScheduled = false;
  if (stopping || !handler) return;
  try {
    while (active < concurrency()) {
      const job = claimNext();
      if (!job) break;
      void runJob(job);
    }
  } catch (error) {
    // The periodic wake remains active, so transient SQLite failures can
    // recover without crashing the whole HTTP process.
    console.error("[enrichment] queue drain failed", error);
  }
}

function wakeWorker(): void {
  if (wakeScheduled || stopping || !handler) return;
  wakeScheduled = true;
  setImmediate(drain);
}

export function startEnrichmentWorker(nextHandler: EnrichmentHandler): void {
  if (handler) return;
  handler = nextHandler;
  stopping = false;
  recoverJobs();
  pollTimer = setInterval(wakeWorker, POLL_INTERVAL_MS);
  pollTimer.unref();
  wakeWorker();
}

export async function stopEnrichmentWorker(timeoutMs = 8_000): Promise<void> {
  stopping = true;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  const deadline = Date.now() + timeoutMs;
  while (active > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  handler = null;
}

export function getEnrichmentQueueStats(): EnrichmentQueueStats {
  const counts = sqlite
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
         SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         MIN(CASE WHEN status = 'queued' THEN created_at END) AS oldestQueuedAt
       FROM enrichment_jobs`
    )
    .get() as {
    queued: number | null;
    running: number | null;
    failed: number | null;
    oldestQueuedAt: number | null;
  };
  return {
    queued: counts.queued ?? 0,
    running: counts.running ?? 0,
    failed: counts.failed ?? 0,
    oldestQueuedAt: counts.oldestQueuedAt ?? null,
  };
}
