import { and, desc, eq, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  AiStatus,
  CardStatus,
  FetchStatus,
  FlashCard,
  ImportSource,
  Platform,
  SummaryBasis,
} from "@shannian/shared";
import { db, sqlite } from "../db/index.js";
import { cards, categories } from "../db/schema.js";
import { detectPlatform, extractFirstUrl, normalizeUrl } from "../lib/url.js";
import { fetchUrlMeta } from "./adapters/index.js";
import { suggestForCard } from "./ai.js";
import { getAiConfig, getMinioConfig } from "../lib/settings.js";
import { uploadVaultMarkdown, vaultObjectKey } from "./minio.js";
import {
  deleteThumbnailByKey,
  saveThumbnailFromUrl,
} from "./thumbs.js";
import {
  isShellTitle,
  mergeAuthor,
  mergeTitle,
  placeholderTitleFromText,
  titleFromAi,
} from "./title.js";

function now() {
  return Date.now();
}

function ftsSync(cardId: string, fields: {
  title?: string | null;
  note?: string | null;
  author?: string | null;
  url?: string | null;
}) {
  sqlite.prepare("DELETE FROM cards_fts WHERE card_id = ?").run(cardId);
  sqlite
    .prepare(
      "INSERT INTO cards_fts (card_id, title, note, author, url) VALUES (?, ?, ?, ?, ?)"
    )
    .run(
      cardId,
      fields.title || "",
      fields.note || "",
      fields.author || "",
      fields.url || ""
    );
}

export async function toFlashCard(row: typeof cards.$inferSelect): Promise<FlashCard> {
  let categoryName: string | null = null;
  if (row.categoryId) {
    const cat = await db.select().from(categories).where(eq(categories.id, row.categoryId)).get();
    categoryName = cat?.name ?? null;
  }
  return {
    id: row.id,
    url: row.url,
    urlNormalized: row.urlNormalized,
    platform: (row.platform as Platform) || null,
    title: row.title,
    author: row.author,
    thumbnailKey: row.thumbnailKey,
    thumbnailUrl: row.thumbnailKey ? `/api/media/${encodeURIComponent(row.thumbnailKey)}` : null,
    note: row.note,
    categoryId: row.categoryId,
    categoryName,
    status: row.status as CardStatus,
    fetchStatus: row.fetchStatus as FetchStatus,
    aiStatus: row.aiStatus as AiStatus,
    summary: row.summary,
    description: row.description ?? null,
    contentExcerpt: row.contentExcerpt ?? null,
    summaryBasis: (row.summaryBasis as SummaryBasis) || null,
    importSource: (row.importSource as ImportSource) || null,
    externalId: row.externalId ?? null,
    depositedAt: row.depositedAt,
    depositedObjectKey: row.depositedObjectKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

async function refreshFts(cardId: string) {
  const row = await db.select().from(cards).where(eq(cards.id, cardId)).get();
  if (!row) return;
  ftsSync(cardId, {
    title: row.title,
    note: row.note,
    author: row.author,
    url: row.url,
  });
}

export async function createCard(input: {
  text?: string;
  url?: string | null;
  note?: string | null;
}): Promise<{ card: FlashCard; existing: boolean }> {
  let url = input.url ?? null;
  let note = input.note ?? null;

  if (input.text != null && input.text.trim()) {
    const extracted = extractFirstUrl(input.text.trim());
    if (extracted.url) {
      url = extracted.url;
      note = extracted.rest || note;
    } else {
      note = input.text.trim();
    }
  }

  url = url?.trim() || null;
  note = note?.trim() || null;
  if (!url && !note) {
    throw new Error("EMPTY_CARD");
  }

  const urlNormalized = url ? normalizeUrl(url) : null;

  if (urlNormalized) {
    const existing = await db
      .select()
      .from(cards)
      .where(and(eq(cards.urlNormalized, urlNormalized), isNull(cards.deletedAt)))
      .get();
    if (existing) {
      if (note) {
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
        const appended = existing.note
          ? `${existing.note}\n\n---\n[${stamp} 追加]\n${note}`
          : `[${stamp} 追加]\n${note}`;
        await db
          .update(cards)
          .set({ note: appended, updatedAt: now() })
          .where(eq(cards.id, existing.id));
        await refreshFts(existing.id);
      }
      const updated = await db.select().from(cards).where(eq(cards.id, existing.id)).get();
      return { card: await toFlashCard(updated!), existing: true };
    }
  }

  const id = nanoid();
  const ts = now();
  const platform = url ? detectPlatform(url) : null;
  const hasAi = Boolean(await getAiConfig());

  // Pure thought (C1): note = full text, title = short head; lands in inbox + 想法
  const pureThoughtTitle =
    !url && note
      ? placeholderTitleFromText(note) || note.slice(0, 28)
      : null;

  await db.insert(cards).values({
    id,
    url,
    urlNormalized,
    platform,
    title: pureThoughtTitle,
    author: null,
    thumbnailKey: null,
    note,
    categoryId: null,
    status: "inbox",
    fetchStatus: url ? "pending" : "skipped",
    aiStatus: hasAi ? "pending" : "skipped",
    summary: null,
    description: null,
    // Pure thoughts: feed note to AI for category only (title locked in enrich)
    contentExcerpt: !url && note ? note.slice(0, 6000) : null,
    summaryBasis: null,
    rawMeta: null,
    importSource: null,
    externalId: null,
    depositedAt: null,
    depositedObjectKey: null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  });

  await refreshFts(id);
  const row = await db.select().from(cards).where(eq(cards.id, id)).get();
  const card = await toFlashCard(row!);

  // fire and forget enrichment
  queueEnrichment(id);

  return { card, existing: false };
}

const enriching = new Set<string>();

export async function markEnrichPending(cardId: string) {
  await db
    .update(cards)
    .set({ aiStatus: "pending", updatedAt: now() })
    .where(eq(cards.id, cardId));
}

export function queueEnrichment(cardId: string, opts?: { force?: boolean }) {
  if (enriching.has(cardId)) return;
  enriching.add(cardId);
  setImmediate(() => {
    enrichCard(cardId, opts)
      .catch((e) => console.error("enrich failed", cardId, e))
      .finally(() => enriching.delete(cardId));
  });
}

export async function enrichCard(cardId: string, opts?: { force?: boolean }) {
  const force = Boolean(opts?.force);
  const row = await db.select().from(cards).where(eq(cards.id, cardId)).get();
  if (!row || row.deletedAt) return;

  const shouldFetch = Boolean(row.url) && (force || row.fetchStatus !== "ok");

  if (shouldFetch && row.url) {
    try {
      const meta = await fetchUrlMeta(row.url);
      let thumbnailKey = row.thumbnailKey;
      if (meta.thumbnailUrl) {
        const key = await saveThumbnailFromUrl(cardId, meta.thumbnailUrl);
        if (key) thumbnailKey = key;
      }
      // Platform/og titles are weak; prefer body head as temp placeholder until AI 精炼标题
      const bodyForTitle =
        meta.contentExcerpt?.trim() ||
        meta.description?.trim() ||
        (meta.title && !isShellTitle(meta.title) ? meta.title : null) ||
        null;
      const nextTitle = mergeTitle({
        existing: row.title,
        incoming: null,
        ruleFromBody: bodyForTitle,
        force,
      });
      const nextAuthor = mergeAuthor({
        existing: row.author,
        incoming: meta.author,
        force,
      });
      const nextDescription =
        meta.description ?? (force ? null : row.description);
      const nextExcerpt =
        meta.contentExcerpt ?? (force ? null : row.contentExcerpt);
      const hasCore = Boolean(
        (nextTitle && !isShellTitle(nextTitle)) ||
          nextDescription?.trim() ||
          nextExcerpt?.trim()
      );
      await db
        .update(cards)
        .set({
          platform: meta.platform,
          title: nextTitle,
          author: nextAuthor,
          thumbnailKey,
          description: nextDescription,
          contentExcerpt: nextExcerpt,
          fetchStatus: hasCore
            ? nextAuthor || thumbnailKey || nextDescription
              ? "ok"
              : "partial"
            : "partial",
          rawMeta: JSON.stringify(meta.raw ?? meta),
          updatedAt: now(),
        })
        .where(eq(cards.id, cardId));
    } catch (e) {
      await db
        .update(cards)
        .set({
          fetchStatus: "failed",
          rawMeta: JSON.stringify({ error: String(e) }),
          updatedAt: now(),
        })
        .where(eq(cards.id, cardId));
    }
  }

  const afterFetch = await db.select().from(cards).where(eq(cards.id, cardId)).get();
  if (!afterFetch) return;

  const aiConfig = await getAiConfig();
  if (!aiConfig) {
    if (afterFetch.aiStatus === "pending" || force) {
      await db
        .update(cards)
        .set({ aiStatus: "skipped", updatedAt: now() })
        .where(eq(cards.id, cardId));
    }
    await refreshFts(cardId);
    return;
  }

  if (force) {
    await db
      .update(cards)
      .set({ aiStatus: "pending", updatedAt: now() })
      .where(eq(cards.id, cardId));
  }

  try {
    const cats = await db.select().from(categories).all();
    const suggestion = await suggestForCard({
      title: afterFetch.title,
      author: afterFetch.author,
      platform: afterFetch.platform,
      url: afterFetch.url,
      note: afterFetch.note,
      description: afterFetch.description,
      contentExcerpt: afterFetch.contentExcerpt,
      categories: cats.map((c) => c.name),
    });

    let categoryId = afterFetch.categoryId;
    if (suggestion.category) {
      const cat = cats.find((c) => c.name === suggestion.category);
      if (cat) categoryId = cat.id;
    } else if (force) {
      categoryId = afterFetch.categoryId;
    }

    const isPureThought = !afterFetch.url;
    const bodyForTitle =
      afterFetch.contentExcerpt?.trim() ||
      afterFetch.description?.trim() ||
      null;
    // I3: pure thoughts — category only; never overwrite user title
    // Link cards: AI 精炼短摘要 → title
    const nextTitle = isPureThought
      ? afterFetch.title
      : titleFromAi({
          existing: afterFetch.title,
          aiTitle: suggestion.title,
          aiSummary: suggestion.summary,
          ruleFromBody: bodyForTitle,
          force,
        });
    const nextSummary = isPureThought
      ? afterFetch.summary
      : force
        ? suggestion.summary
        : afterFetch.summary || suggestion.summary;

    await db
      .update(cards)
      .set({
        categoryId: force
          ? suggestion.category
            ? categoryId
            : afterFetch.categoryId
          : afterFetch.categoryId || categoryId,
        title: nextTitle,
        summary: nextSummary,
        summaryBasis: isPureThought
          ? afterFetch.summaryBasis
          : force
            ? suggestion.summaryBasis
            : afterFetch.summaryBasis || suggestion.summaryBasis,
        aiStatus: "ok",
        updatedAt: now(),
      })
      .where(eq(cards.id, cardId));
  } catch (e) {
    let prevRaw: Record<string, unknown> = {};
    try {
      prevRaw = afterFetch.rawMeta ? JSON.parse(afterFetch.rawMeta) : {};
    } catch {
      prevRaw = {};
    }
    await db
      .update(cards)
      .set({
        aiStatus: "failed",
        rawMeta: JSON.stringify({
          ...prevRaw,
          aiError: String(e),
        }),
        updatedAt: now(),
      })
      .where(eq(cards.id, cardId));
  }

  await refreshFts(cardId);
}

export interface ListQuery {
  q?: string;
  status?: CardStatus | "all";
  categoryId?: string;
  platform?: string;
  thoughtsOnly?: boolean;
  linksOnly?: boolean;
  incomplete?: boolean;
  aiFailed?: boolean;
  trash?: boolean;
  limit?: number;
  offset?: number;
}

export async function listCards(query: ListQuery): Promise<{ items: FlashCard[]; total: number }> {
  const limit = Math.min(query.limit ?? 100, 200);
  const offset = query.offset ?? 0;

  const conditions = [];
  if (query.trash) {
    conditions.push(isNotNull(cards.deletedAt));
  } else {
    conditions.push(isNull(cards.deletedAt));
  }

  // N2: 沉淀 = organized + legacy deposited
  if (query.status === "organized") {
    conditions.push(
      or(eq(cards.status, "organized"), eq(cards.status, "deposited"))!
    );
  } else if (query.status && query.status !== "all") {
    conditions.push(eq(cards.status, query.status));
  }
  if (query.categoryId) conditions.push(eq(cards.categoryId, query.categoryId));
  if (query.platform) conditions.push(eq(cards.platform, query.platform));
  // T1: 想法 = note non-empty (not merely url-less)
  if (query.thoughtsOnly) {
    conditions.push(
      and(isNotNull(cards.note), sql`trim(${cards.note}) != ''`)!
    );
  }
  if (query.linksOnly) conditions.push(isNotNull(cards.url));
  // 待补全：解析失败/残缺、有链无封面、AI 失败、已结束 AI 但无摘要
  if (query.incomplete) {
    conditions.push(
      or(
        eq(cards.fetchStatus, "partial"),
        eq(cards.fetchStatus, "failed"),
        and(isNotNull(cards.url), isNull(cards.thumbnailKey)),
        eq(cards.aiStatus, "failed"),
        and(
          isNull(cards.summary),
          sql`${cards.aiStatus} NOT IN ('pending', 'skipped')`
        )
      )!
    );
  }
  if (query.aiFailed) conditions.push(eq(cards.aiStatus, "failed"));

  let idFilter: string[] | null = null;
  if (query.q?.trim()) {
    const raw = query.q.trim();
    let ftsIds: string[] = [];
    try {
      const safe = raw.replace(/["*]/g, " ").trim();
      if (safe) {
        const fts = sqlite
          .prepare(
            `SELECT card_id FROM cards_fts WHERE cards_fts MATCH ? LIMIT 500`
          )
          .all(safe) as { card_id: string }[];
        ftsIds = fts.map((r) => r.card_id);
      }
    } catch {
      ftsIds = [];
    }
    // Always also OR with LIKE for CJK friendliness
    const likeIds = (
      await db
        .select({ id: cards.id })
        .from(cards)
        .where(
          or(
            like(cards.title, `%${raw}%`),
            like(cards.note, `%${raw}%`),
            like(cards.author, `%${raw}%`),
            like(cards.url, `%${raw}%`)
          )
        )
        .all()
    ).map((r) => r.id);
    idFilter = [...new Set([...ftsIds, ...likeIds])];
  }



  if (idFilter) {
    if (idFilter.length === 0) return { items: [], total: 0 };
    conditions.push(sql`${cards.id} IN (${sql.join(idFilter.map((id) => sql`${id}`), sql`, `)})`);
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(cards)
    .where(where)
    .orderBy(desc(cards.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  const countRow = await db
    .select({ c: sql<number>`count(*)` })
    .from(cards)
    .where(where)
    .get();

  const items = await Promise.all(rows.map(toFlashCard));
  return { items, total: countRow?.c ?? items.length };
}

export async function getCard(id: string): Promise<FlashCard | null> {
  const row = await db.select().from(cards).where(eq(cards.id, id)).get();
  if (!row) return null;
  return toFlashCard(row);
}

export async function updateCard(
  id: string,
  patch: {
    title?: string | null;
    author?: string | null;
    note?: string | null;
    url?: string | null;
    categoryId?: string | null;
    status?: CardStatus;
    platform?: Platform | null;
  }
): Promise<FlashCard | null> {
  const row = await db.select().from(cards).where(eq(cards.id, id)).get();
  if (!row || row.deletedAt) return null;

  const updates: Partial<typeof cards.$inferInsert> = { updatedAt: now() };
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.author !== undefined) updates.author = patch.author;
  if (patch.note !== undefined) updates.note = patch.note;
  if (patch.categoryId !== undefined) updates.categoryId = patch.categoryId;
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.platform !== undefined) updates.platform = patch.platform;
  if (patch.url !== undefined) {
    updates.url = patch.url;
    updates.urlNormalized = patch.url ? normalizeUrl(patch.url) : null;
    if (patch.url) updates.platform = detectPlatform(patch.url);
  }

  await db.update(cards).set(updates).where(eq(cards.id, id));

  await refreshFts(id);
  return getCard(id);
}

export async function softDeleteCard(id: string): Promise<boolean> {
  const row = await db.select().from(cards).where(eq(cards.id, id)).get();
  if (!row) return false;
  await db.update(cards).set({ deletedAt: now(), updatedAt: now() }).where(eq(cards.id, id));
  return true;
}

export async function restoreCard(id: string): Promise<FlashCard | null> {
  await db.update(cards).set({ deletedAt: null, updatedAt: now() }).where(eq(cards.id, id));
  return getCard(id);
}

/**
 * Permanent delete. If the card was claimed from a platform bookmark and
 * force is false, attempts platform revoke first; on failure returns REVOKE_FAILED
 * without deleting local data.
 */
export async function purgeCard(
  id: string,
  opts?: { force?: boolean }
): Promise<{ ok: true } | { ok: false; error: "REVOKE_FAILED"; message: string }> {
  const row = await db.select().from(cards).where(eq(cards.id, id)).get();
  if (!row) return { ok: true };

  const force = Boolean(opts?.force);
  if (row.importSource && row.externalId) {
    const { tryRevokeImport } = await import("./import/registry.js");
    const revoke = await tryRevokeImport(row.importSource, row.externalId);
    if (!revoke.ok && !force) {
      return {
        ok: false,
        error: "REVOKE_FAILED",
        message: revoke.message || "取消原平台收藏失败",
      };
    }
  }

  await deleteThumbnailByKey(row.thumbnailKey);
  sqlite.prepare("DELETE FROM cards_fts WHERE card_id = ?").run(id);
  await db.delete(cards).where(eq(cards.id, id));
  return { ok: true };
}

/**
 * Lightweight meta backfill: cover + author (no AI).
 * Returns true if anything was updated.
 */
export async function fillMissingThumbnail(cardId: string): Promise<boolean> {
  const row = await db.select().from(cards).where(eq(cards.id, cardId)).get();
  if (!row || row.deletedAt || !row.url) return false;
  const needsThumb = !row.thumbnailKey;
  const needsAuthor = !row.author;
  if (!needsThumb && !needsAuthor) return false;
  try {
    const meta = await fetchUrlMeta(row.url);
    const patch: {
      thumbnailKey?: string | null;
      author?: string | null;
      updatedAt: number;
    } = { updatedAt: now() };
    let changed = false;
    if (needsThumb && meta.thumbnailUrl) {
      const key = await saveThumbnailFromUrl(cardId, meta.thumbnailUrl);
      if (key) {
        patch.thumbnailKey = key;
        changed = true;
      }
    }
    if (needsAuthor && meta.author) {
      const next = mergeAuthor({ existing: row.author, incoming: meta.author });
      if (next && next !== row.author) {
        patch.author = next;
        changed = true;
      }
    }
    // Recover @handle from x.com/{user}/status/ URLs
    if (needsAuthor && !patch.author && row.url) {
      const m = row.url.match(/x\.com\/([A-Za-z0-9_]+)\/status/i);
      if (m && m[1] && m[1].toLowerCase() !== "i") {
        patch.author = `@${m[1]}`;
        changed = true;
      }
    }
    if (!changed) return false;
    await db.update(cards).set(patch).where(eq(cards.id, cardId));
    return true;
  } catch (e) {
    console.warn("[thumbs] fill failed", cardId, e instanceof Error ? e.message : e);
    return false;
  }
}

let thumbBackfillRunning = false;

/** Background: fill missing covers/authors for existing cards (rate-limited). */
export function queueThumbnailBackfill(opts?: { delayMs?: number }) {
  if (thumbBackfillRunning) return;
  thumbBackfillRunning = true;
  const delayMs = opts?.delayMs ?? 800;
  setImmediate(async () => {
    try {
      const rows = sqlite
        .prepare(
          `SELECT id FROM cards
           WHERE deleted_at IS NULL AND url IS NOT NULL
             AND (thumbnail_key IS NULL OR author IS NULL)
           ORDER BY created_at DESC`
        )
        .all() as { id: string }[];
      console.log(`[thumbs] backfill start: ${rows.length} cards missing cover/author`);
      let ok = 0;
      for (const row of rows) {
        const saved = await fillMissingThumbnail(row.id);
        if (saved) ok += 1;
        await new Promise((r) => setTimeout(r, delayMs));
      }
      console.log(`[thumbs] backfill done: ${ok}/${rows.length} updated`);
    } catch (e) {
      console.error("[thumbs] backfill error", e);
    } finally {
      thumbBackfillRunning = false;
    }
  });
}

export type BulkAction = "organize" | "trash" | "retry";

export async function bulkCards(
  ids: string[],
  action: BulkAction
): Promise<{ ok: number; failed: number }> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 200);
  let ok = 0;
  let failed = 0;
  for (const id of unique) {
    try {
      if (action === "organize") {
        const card = await updateCard(id, { status: "organized" });
        if (card) ok += 1;
        else failed += 1;
      } else if (action === "trash") {
        const done = await softDeleteCard(id);
        if (done) ok += 1;
        else failed += 1;
      } else if (action === "retry") {
        const existing = await getCard(id);
        if (!existing || existing.deletedAt) {
          failed += 1;
          continue;
        }
        await markEnrichPending(id);
        queueEnrichment(id, { force: true });
        ok += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return { ok, failed };
}

/** Find non-deleted card by import source + external id */
export async function findByExternal(
  importSource: string,
  externalId: string
): Promise<typeof cards.$inferSelect | null> {
  const row = await db
    .select()
    .from(cards)
    .where(
      and(
        eq(cards.importSource, importSource),
        eq(cards.externalId, externalId),
        isNull(cards.deletedAt)
      )
    )
    .get();
  return row ?? null;
}

/**
 * Upsert a platform-imported bookmark.
 * - already: same import_source+external_id present (incremental stop signal)
 * - claimed: URL existed; filled missing import identity only
 * - imported: new card
 * - skipped: cannot claim (e.g. conflict) or invalid input
 */
export async function upsertImportedBookmark(input: {
  url: string;
  importSource: ImportSource;
  externalId: string;
  title?: string | null;
  author?: string | null;
  /** Full post body for AI evidence (stored as contentExcerpt, not page meta description) */
  description?: string | null;
  raw?: unknown;
}): Promise<"imported" | "claimed" | "already" | "skipped"> {
  const url = input.url.trim();
  const urlNormalized = normalizeUrl(url);
  const externalId = input.externalId.trim();
  if (!url || !externalId) return "skipped";

  const byExternal = await findByExternal(input.importSource, externalId);
  if (byExternal) return "already";

  const existing = await db
    .select()
    .from(cards)
    .where(and(eq(cards.urlNormalized, urlNormalized), isNull(cards.deletedAt)))
    .get();

  if (existing) {
    if (
      existing.importSource === input.importSource &&
      existing.externalId === externalId
    ) {
      return "already";
    }
    // Claim identity only when missing — never overwrite content or a different claim
    if (!existing.importSource && !existing.externalId) {
      await db
        .update(cards)
        .set({
          importSource: input.importSource,
          externalId,
          updatedAt: now(),
        })
        .where(eq(cards.id, existing.id));
      return "claimed";
    }
    if (!existing.importSource || !existing.externalId) {
      await db
        .update(cards)
        .set({
          importSource: existing.importSource || input.importSource,
          externalId: existing.externalId || externalId,
          updatedAt: now(),
        })
        .where(eq(cards.id, existing.id));
      return "claimed";
    }
    return "skipped";
  }

  const id = nanoid();
  const ts = now();
  const hasAi = Boolean(await getAiConfig());
  const platform = detectPlatform(url);
  // Imported post body is content, not og/meta description — store once as contentExcerpt
  const contentExcerpt = input.description?.trim()
    ? input.description.trim().slice(0, 6000)
    : null;
  // Prefer short topic placeholder from body; never store raw 200-char dump as "title"
  const title =
    (input.title && !isShellTitle(input.title)
      ? placeholderTitleFromText(input.title) || input.title.trim().slice(0, 40)
      : null) ||
    placeholderTitleFromText(contentExcerpt) ||
    null;
  const author = input.author?.trim() || null;

  await db.insert(cards).values({
    id,
    url,
    urlNormalized,
    platform,
    title,
    author,
    thumbnailKey: null,
    note: null,
    categoryId: null,
    status: "inbox",
    // partial so enrich still runs for thumb / AI, but title merge won't clobber good titles
    fetchStatus: title || contentExcerpt ? "partial" : "pending",
    aiStatus: hasAi ? "pending" : "skipped",
    summary: null,
    description: null,
    contentExcerpt,
    summaryBasis: null,
    rawMeta: input.raw ? JSON.stringify({ import: input.raw }) : null,
    importSource: input.importSource,
    externalId,
    depositedAt: null,
    depositedObjectKey: null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  });

  await refreshFts(id);
  queueEnrichment(id);
  return "imported";
}

export async function appendNote(id: string, note: string): Promise<FlashCard | null> {
  const row = await db.select().from(cards).where(eq(cards.id, id)).get();
  if (!row || row.deletedAt) return null;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const appended = row.note
    ? `${row.note}\n\n---\n[${stamp} 追加]\n${note}`
    : note;
  await db.update(cards).set({ note: appended, updatedAt: now() }).where(eq(cards.id, id));
  await refreshFts(id);
  return getCard(id);
}

export async function inboxCount(): Promise<number> {
  const row = await db
    .select({ c: sql<number>`count(*)` })
    .from(cards)
    .where(and(isNull(cards.deletedAt), eq(cards.status, "inbox")))
    .get();
  return row?.c ?? 0;
}

export async function randomReviewCard(): Promise<FlashCard | null> {
  // Prefer inbox without summary (need decision), then any inbox, then organized
  const row =
    (sqlite
      .prepare(
        `SELECT id FROM cards WHERE deleted_at IS NULL AND status = 'inbox'
         AND (summary IS NULL OR summary = '') ORDER BY RANDOM() LIMIT 1`
      )
      .get() as { id: string } | undefined) ||
    (sqlite
      .prepare(
        `SELECT id FROM cards WHERE deleted_at IS NULL AND status = 'inbox'
         ORDER BY RANDOM() LIMIT 1`
      )
      .get() as { id: string } | undefined) ||
    (sqlite
      .prepare(
        `SELECT id FROM cards WHERE deleted_at IS NULL AND status = 'organized'
         ORDER BY RANDOM() LIMIT 1`
      )
      .get() as { id: string } | undefined);
  if (!row) return null;
  return getCard(row.id);
}

export async function exportObsidian(cardId: string): Promise<FlashCard | null> {
  const card = await getCard(cardId);
  if (!card || card.deletedAt) return null;
  const minio = await getMinioConfig();
  if (!minio) throw new Error("MINIO_NOT_CONFIGURED");

  const md = `---
闪念id: ${card.id}
title: ${JSON.stringify(card.title || "")}
url: ${card.url || ""}
platform: ${card.platform || ""}
author: ${JSON.stringify(card.author || "")}
category: ${JSON.stringify(card.categoryName || "")}
created: ${new Date(card.createdAt).toISOString()}
---

# ${card.title || "无标题"}

${card.url ? `> 原链：${card.url}\n` : ""}
## 我的想法

${card.note || "_（无）_"}

## 摘要

${card.summary || "_（无）_"}
`;

  const key = vaultObjectKey(card.id, card.title, minio.vaultPrefix);
  const ok = await uploadVaultMarkdown(key, md);
  if (!ok) throw new Error("MINIO_UPLOAD_FAILED");

  await db
    .update(cards)
    .set({
      status: "deposited",
      depositedAt: now(),
      depositedObjectKey: key,
      updatedAt: now(),
    })
    .where(eq(cards.id, cardId));

  return getCard(cardId);
}

export async function exportAllJson() {
  const rows = await db.select().from(cards).where(isNull(cards.deletedAt)).all();
  const items = await Promise.all(rows.map(toFlashCard));
  const cats = await db.select().from(categories).all();
  return {
    exportedAt: new Date().toISOString(),
    categories: cats,
    cards: items,
  };
}
