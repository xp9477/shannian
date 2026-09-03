import { nanoid } from "nanoid";
import type { ImportJob } from "@shannian/shared";
import { getSetting, setSetting } from "../../lib/settings.js";
import { upsertImportedBookmark } from "../cards.js";
import {
  DEFAULT_BOOKMARKS_QUERY_ID,
  fetchBookmarksPage,
  withBackoff,
  type XBookmarkItem,
} from "./x-client.js";
import { getXCredentials, getXQueryIds } from "./x-credentials.js";

const JOB_KEY = "import_job_x";

/** Conservative defaults — prefer not getting rate-limited / flagged */
const configuredPageDelay = Number(process.env.X_IMPORT_PAGE_DELAY_MS || 2000);
const PAGE_DELAY_MS = Number.isFinite(configuredPageDelay)
  ? Math.max(500, Math.min(Math.floor(configuredPageDelay), 60_000))
  : 2_000;
const PAGE_SIZE = 20;

let cancelRequested = false;
let running = false;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadJob(): Promise<ImportJob | null> {
  const raw = await getSetting(JOB_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ImportJob;
  } catch {
    return null;
  }
}

async function saveJob(job: ImportJob): Promise<void> {
  job.updatedAt = Date.now();
  await setSetting(JOB_KEY, JSON.stringify(job));
}

export async function getXImportJob(): Promise<ImportJob | null> {
  return loadJob();
}

/**
 * An import executes inside this process, so a persisted `running` state cannot
 * still be valid after a restart. Make the interruption explicit instead of
 * leaving the UI polling a job that no worker can ever finish.
 */
export async function recoverInterruptedXImport(): Promise<void> {
  const job = await loadJob();
  if (!job || job.status !== "running") return;
  job.status = "failed";
  job.error = "IMPORT_INTERRUPTED";
  job.message = "服务重启中断了导入，请重新开始";
  await saveJob(job);
}

export async function cancelXImport(): Promise<ImportJob | null> {
  cancelRequested = true;
  const job = await loadJob();
  if (job && job.status === "running") {
    job.status = "cancelled";
    job.message = "用户取消";
    await saveJob(job);
  }
  return loadJob();
}

export async function startXImport(opts: { forceFull?: boolean } = {}): Promise<ImportJob> {
  // Claim synchronously before the first await so two HTTP requests in the same
  // event-loop turn cannot both start an import.
  if (running) throw new Error("IMPORT_ALREADY_RUNNING");
  running = true;

  const creds = await getXCredentials().catch((error) => {
    running = false;
    throw error;
  });
  if (!creds) {
    running = false;
    throw new Error("X_CREDENTIALS_MISSING");
  }

  cancelRequested = false;
  const job: ImportJob = {
    id: nanoid(),
    platform: "x",
    status: "running",
    forceFull: Boolean(opts.forceFull),
    scanned: 0,
    imported: 0,
    claimed: 0,
    skipped: 0,
    error: null,
    message: opts.forceFull ? "强制全量扫描…" : "增量导入…",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  try {
    await saveJob(job);
  } catch (error) {
    running = false;
    throw error;
  }
  setImmediate(() => {
    void runImport(job.id)
      .catch(async (e) => {
        console.error("[x-import] failed", e instanceof Error ? e.message : e);
        try {
          const j = await loadJob();
          if (j && j.id === job.id && j.status === "running") {
            j.status = "failed";
            j.error = e instanceof Error ? e.message : String(e);
            j.message = "导入失败";
            await saveJob(j);
          }
        } catch (persistError) {
          console.error("[x-import] could not persist failure", persistError);
        }
      })
      .finally(() => {
        running = false;
      });
  });

  return job;
}

async function runImport(jobId: string): Promise<void> {
  const creds = await getXCredentials();
  if (!creds) throw new Error("X_CREDENTIALS_MISSING");

  const qids = await getXQueryIds();
  const queryId = qids.bookmarks || DEFAULT_BOOKMARKS_QUERY_ID;

  let cursor: string | null = null;
  let page = 0;

  while (true) {
    if (cancelRequested) {
      const j = await loadJob();
      if (j && j.id === jobId) {
        j.status = "cancelled";
        j.message = "已取消";
        await saveJob(j);
      }
      return;
    }

    let j = await loadJob();
    if (!j || j.id !== jobId) return;
    if (j.status === "cancelled") return;

    let pageResult: { items: XBookmarkItem[]; nextCursor: string | null };
    try {
      pageResult = await withBackoff(() =>
        fetchBookmarksPage(creds, { cursor, count: PAGE_SIZE, queryId })
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      j = (await loadJob())!;
      if (j.id !== jobId) return;
      j.status = "failed";
      j.error = msg;
      j.message =
        msg === "AUTH_FAILED"
          ? "凭证无效，请更新 auth_token / ct0"
          : msg.startsWith("BOOKMARKS_HTTP")
            ? `拉取书签失败（GraphQL 可能已变更 query id）：${msg}`
            : msg;
      await saveJob(j);
      return;
    }

    page += 1;
    let pageChanged = false;

    for (const item of pageResult.items) {
      if (cancelRequested) break;

      j = (await loadJob())!;
      if (j.id !== jobId || j.status !== "running") return;

      j.scanned += 1;
      const author = item.authorScreenName
        ? `@${item.authorScreenName.replace(/^@+/, "")}`
        : null;
      const text = item.text?.trim() || null;
      const result = await upsertImportedBookmark({
        url: item.url,
        importSource: "x_bookmark",
        externalId: item.tweetId,
        title: text,
        author,
        description: text,
        media: item.media,
        raw: item.raw,
      });

      if (result === "imported") {
        j.imported += 1;
        pageChanged = true;
      } else if (result === "claimed") {
        j.claimed += 1;
        pageChanged = true;
      } else if (result === "already") j.skipped += 1;
      else j.skipped += 1;

      j.message = `已扫描 ${j.scanned} · 新建 ${j.imported} · 认领 ${j.claimed}`;
      await saveJob(j);
    }

    if (cancelRequested) {
      j = (await loadJob())!;
      if (j.id === jobId) {
        j.status = "cancelled";
        j.message = "已取消";
        await saveJob(j);
      }
      return;
    }

    // Stop only after a complete page contains no new/claimed item. Stopping
    // at the first duplicate loses the rest of a partly committed page after
    // a crash or cancellation.
    if (!j.forceFull && !pageChanged) {
      j = (await loadJob())!;
      if (j.id === jobId) {
        j.status = "completed";
        j.message = `增量完成：本页无新书签；新建 ${j.imported}，认领 ${j.claimed}，跳过 ${j.skipped}`;
        await saveJob(j);
      }
      return;
    }

    if (!pageResult.nextCursor || pageResult.items.length === 0) {
      j = (await loadJob())!;
      if (j.id === jobId) {
        j.status = "completed";
        j.message = `完成：新建 ${j.imported}，认领 ${j.claimed}，跳过 ${j.skipped}（共扫描 ${j.scanned}）`;
        await saveJob(j);
      }
      return;
    }

    cursor = pageResult.nextCursor;
    // page delay
    await sleep(PAGE_DELAY_MS + Math.floor(Math.random() * 800));

    // safety cap
    if (page >= 500) {
      j = (await loadJob())!;
      if (j.id === jobId) {
        j.status = "completed";
        j.message = `达到页数上限，已扫描 ${j.scanned}。可稍后再点强制全量。`;
        await saveJob(j);
      }
      return;
    }
  }
}
