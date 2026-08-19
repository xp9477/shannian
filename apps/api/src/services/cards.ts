import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  AiStatus,
  CardMediaItem,
  CardStatus,
  FetchStatus,
  FlashCard,
  ImportSource,
  Platform,
  SummaryBasis,
} from "@shannian/shared";
import { db, sqlite } from "../db/index.js";
import { cards, categories } from "../db/schema.js";
import {
  detectPlatform,
  extractFirstUrl,
  normalizeUrl,
  parseHttpUrl,
} from "../lib/url.js";
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
import { enqueueEnrichmentJob } from "./enrichment-queue.js";
import { AppError } from "../lib/errors.js";

function now() {
  return Date.now();
}

function fetchErrorFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.fetchError === "string") return record.fetchError;
  return fetchErrorFromRaw(record.web);
}

function isBareHostnameTitle(title: string | null | undefined, url: string): boolean {
  if (!title) return false;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    return title.trim().replace(/^www\./i, "").toLowerCase() === hostname;
  } catch {
    return false;
  }
}

function serializeRawMeta(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= 100_000) return serialized;
    return JSON.stringify({
      truncated: true,
      originalChars: serialized.length,
      preview: serialized.slice(0, 20_000),
    });
  } catch (error) {
    return JSON.stringify({ serializationError: String(error) });
  }
}

function sameAiEvidence(
  left: typeof cards.$inferSelect,
  right: typeof cards.$inferSelect
): boolean {
  return (
    left.url === right.url &&
    left.title === right.title &&
    left.author === right.author &&
    left.note === right.note &&
    left.description === right.description &&
    left.contentExcerpt === right.contentExcerpt &&
    left.summary === right.summary
  );
}

const MAX_STORED_NOTE_CHARS = 100_000;

function appendNoteTransaction(
  cardId: string,
  addition: string,
  stampWhenEmpty: boolean
): boolean {
  const append = sqlite.transaction(() => {
    const existing = sqlite
      .prepare("SELECT note FROM cards WHERE id = ? AND deleted_at IS NULL")
      .get(cardId) as { note: string | null } | undefined;
    if (!existing) return false;
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const next = existing.note
      ? `${existing.note}\n\n---\n[${stamp} 追加]\n${addition}`
      : stampWhenEmpty
        ? `[${stamp} 追加]\n${addition}`
        : addition;
    if (next.length > MAX_STORED_NOTE_CHARS) {
      throw new AppError(
        "NOTE_TOO_LARGE",
        413,
        `累计笔记不能超过 ${MAX_STORED_NOTE_CHARS} 字符`
      );
    }
    sqlite
      .prepare("UPDATE cards SET note = ?, updated_at = ? WHERE id = ?")
      .run(next, now(), cardId);
    return true;
  });
  return append();
}

function parseMediaJson(raw: string | null | undefined): CardMediaItem[] {
  if (!raw?.trim()) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.flatMap((value): CardMediaItem[] => {
      if (!value || typeof value !== "object") return [];
      const media = value as Partial<CardMediaItem>;
      const url = safeRemoteMediaUrl(media.url);
      if (!url) return [];
      return [
        {
          type: media.type === "video" || media.type === "gif" ? media.type : "image",
          url,
          posterUrl: safeRemoteMediaUrl(media.posterUrl) ?? null,
          width: safeMediaDimension(media.width),
          height: safeMediaDimension(media.height),
        },
      ];
    });
  } catch {
    return [];
  }
}

function safeRemoteMediaUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4_096) return null;
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeMediaDimension(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), 100_000)
    : null;
}

export async function toFlashCard(
  row: typeof cards.$inferSelect,
  categoryNames?: ReadonlyMap<string, string>
): Promise<FlashCard> {
  let categoryName: string | null = null;
  if (row.categoryId) {
    if (categoryNames) {
      categoryName = categoryNames.get(row.categoryId) ?? null;
    } else {
      const cat = await db
        .select()
        .from(categories)
        .where(eq(categories.id, row.categoryId))
        .get();
      categoryName = cat?.name ?? null;
    }
  }
  const media = parseMediaJson(row.mediaJson);
  return {
    id: row.id,
    url: row.url,
    urlNormalized: row.urlNormalized,
    platform: (row.platform as Platform) || null,
    title: row.title,
    author: row.author,
    thumbnailKey: row.thumbnailKey,
    thumbnailUrl: row.thumbnailKey
      ? `/api/media/${encodeURIComponent(row.thumbnailKey)}`
      : media[0]
        ? media[0].type === "image"
          ? media[0].url
          : media[0].posterUrl || media[0].url
        : null,
    media,
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
  if (url) url = parseHttpUrl(url);
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
        appendNoteTransaction(existing.id, note, true);
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

  try {
    await db.insert(cards).values({
      id,
      url,
      urlNormalized,
      platform,
      title: pureThoughtTitle,
      author: null,
      thumbnailKey: null,
      mediaJson: null,
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
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (!urlNormalized || !code?.startsWith("SQLITE_CONSTRAINT")) throw error;
    const raced = await db
      .select()
      .from(cards)
      .where(and(eq(cards.urlNormalized, urlNormalized), isNull(cards.deletedAt)))
      .get();
    if (!raced) throw error;
    if (note) appendNoteTransaction(raced.id, note, true);
    const latest = await db.select().from(cards).where(eq(cards.id, raced.id)).get();
    return { card: await toFlashCard(latest!), existing: true };
  }

  const row = await db.select().from(cards).where(eq(cards.id, id)).get();
  const card = await toFlashCard(row!);

  // fire and forget enrichment
  queueEnrichment(id);

  return { card, existing: false };
}

export async function markEnrichPending(cardId: string) {
  await db
    .update(cards)
    .set({ aiStatus: "pending", updatedAt: now() })
    .where(eq(cards.id, cardId));
}

export function queueEnrichment(cardId: string, opts?: { force?: boolean }) {
  enqueueEnrichmentJob(cardId, opts);
}

export async function enrichCard(cardId: string, opts?: { force?: boolean }) {
  const force = Boolean(opts?.force);
  const row = await db.select().from(cards).where(eq(cards.id, cardId)).get();
  if (!row || row.deletedAt) return;
  let fetchFailure: unknown = null;

  const shouldFetch = Boolean(row.url) && (force || row.fetchStatus !== "ok");

  if (shouldFetch && row.url) {
    const sourceUrl = row.url;
    let newThumbnailKey: string | null = null;
    try {
      const meta = await fetchUrlMeta(sourceUrl);
      let current = await db.select().from(cards).where(eq(cards.id, cardId)).get();
      if (!current || current.deletedAt) return;
      if (current.url !== sourceUrl) {
        queueEnrichment(cardId, { force });
        return;
      }
      let thumbnailKey = current.thumbnailKey;
      if (meta.thumbnailUrl) {
        const key = await saveThumbnailFromUrl(cardId, meta.thumbnailUrl);
        if (key) {
          newThumbnailKey = key;
          thumbnailKey = key;
        }
      }
      current = await db.select().from(cards).where(eq(cards.id, cardId)).get();
      if (!current || current.deletedAt || current.url !== sourceUrl) {
        if (newThumbnailKey) await deleteThumbnailByKey(newThumbnailKey);
        if (current && !current.deletedAt) queueEnrichment(cardId, { force });
        return;
      }
      // Platform/og titles are weak; prefer body head as temp placeholder until AI 精炼标题
      const bodyForTitle =
        meta.contentExcerpt?.trim() ||
        meta.description?.trim() ||
        (meta.title &&
        !isShellTitle(meta.title) &&
        !isBareHostnameTitle(meta.title, sourceUrl)
          ? meta.title
          : null) ||
        null;
      const nextTitle = mergeTitle({
        existing: current.title,
        incoming: null,
        ruleFromBody: bodyForTitle,
        force,
      });
      const protectedTitle = current.titleLocked ? current.title : nextTitle;
      const nextAuthor = current.authorLocked
        ? current.author
        : mergeAuthor({
            existing: current.author,
            incoming: meta.author,
            force,
          });
      const nextDescription =
        meta.description ?? (force ? null : current.description);
      const nextExcerpt =
        meta.contentExcerpt ?? (force ? null : current.contentExcerpt);
      const nextMedia =
        meta.media && meta.media.length
          ? JSON.stringify(meta.media)
          : force
            ? null
            : current.mediaJson;
      const hasFetchedCore = Boolean(
        bodyForTitle ||
          meta.description?.trim() ||
          meta.contentExcerpt?.trim() ||
          (meta.media && meta.media.length)
      );
      const updated = await db
        .update(cards)
        .set({
          platform: meta.platform,
          title: protectedTitle,
          author: nextAuthor,
          thumbnailKey,
          mediaJson: nextMedia,
          description: nextDescription,
          contentExcerpt: nextExcerpt,
          fetchStatus: hasFetchedCore
            ? nextAuthor || thumbnailKey || nextDescription || nextMedia
              ? "ok"
              : "partial"
            : "partial",
          rawMeta: serializeRawMeta(meta.raw ?? meta),
          updatedAt: now(),
        })
        .where(
          and(
            eq(cards.id, cardId),
            eq(cards.url, sourceUrl),
            eq(cards.updatedAt, current.updatedAt),
            isNull(cards.deletedAt)
          )
        );
      if (updated.changes !== 1) {
        if (newThumbnailKey) await deleteThumbnailByKey(newThumbnailKey);
        queueEnrichment(cardId, { force });
        return;
      }
      if (
        newThumbnailKey &&
        current.thumbnailKey &&
        current.thumbnailKey !== newThumbnailKey
      ) {
        await deleteThumbnailByKey(current.thumbnailKey);
      }
      const reportedError = fetchErrorFromRaw(meta.raw);
      if (reportedError) fetchFailure = new Error(reportedError);
    } catch (e) {
      fetchFailure = e;
      if (newThumbnailKey) await deleteThumbnailByKey(newThumbnailKey);
      await db
        .update(cards)
        .set({
          fetchStatus: "failed",
          rawMeta: serializeRawMeta({ error: String(e) }),
          updatedAt: now(),
        })
        .where(and(eq(cards.id, cardId), eq(cards.url, sourceUrl)));
    }
  }

  const afterFetch = await db.select().from(cards).where(eq(cards.id, cardId)).get();
  if (!afterFetch || afterFetch.deletedAt) return;

  const aiConfig = await getAiConfig();
  if (!aiConfig) {
    if (afterFetch.aiStatus === "pending" || force) {
      await db
        .update(cards)
        .set({ aiStatus: "skipped", updatedAt: now() })
        .where(eq(cards.id, cardId));
    }
    if (fetchFailure) throw fetchFailure;
    return;
  }

  if (!force && afterFetch.aiStatus === "ok") {
    if (fetchFailure) throw fetchFailure;
    return;
  }

  if (force) {
    await db
      .update(cards)
      .set({ aiStatus: "pending", updatedAt: now() })
      .where(eq(cards.id, cardId));
  }

  const aiInput = await db.select().from(cards).where(eq(cards.id, cardId)).get();
  if (!aiInput || aiInput.deletedAt) return;

  try {
    const cats = await db.select().from(categories).all();
    const suggestion = await suggestForCard({
      title: aiInput.title,
      author: aiInput.author,
      platform: aiInput.platform,
      url: aiInput.url,
      note: aiInput.note,
      description: aiInput.description,
      contentExcerpt: aiInput.contentExcerpt,
      categories: cats.map((c) => c.name),
    });

    const latest = await db.select().from(cards).where(eq(cards.id, cardId)).get();
    if (!latest || latest.deletedAt) return;
    if (!sameAiEvidence(aiInput, latest)) {
      queueEnrichment(cardId, { force });
      return;
    }

    let suggestedCategoryId = aiInput.categoryId;
    if (suggestion.category) {
      const cat = cats.find((c) => c.name === suggestion.category);
      if (cat) suggestedCategoryId = cat.id;
    }

    const categoryChangedDuringRequest = latest.categoryId !== aiInput.categoryId;
    const isPureThought = !latest.url;
    const bodyForTitle =
      latest.contentExcerpt?.trim() ||
      latest.description?.trim() ||
      null;
    // I3: pure thoughts — category only; never overwrite user title
    // Link cards: AI 精炼短摘要 → title
    const nextTitle = isPureThought || latest.titleLocked
      ? latest.title
      : titleFromAi({
          existing: latest.title,
          aiTitle: suggestion.title,
          aiSummary: suggestion.summary,
          ruleFromBody: bodyForTitle,
          force,
        });
    const nextSummary = isPureThought
      ? latest.summary
      : force
        ? suggestion.summary
        : latest.summary || suggestion.summary;

    const updated = await db
      .update(cards)
      .set({
        categoryId: latest.categoryLocked || categoryChangedDuringRequest
          ? latest.categoryId
          : force
            ? suggestion.category
              ? suggestedCategoryId
              : latest.categoryId
            : latest.categoryId || suggestedCategoryId,
        title: nextTitle,
        summary: nextSummary,
        summaryBasis: isPureThought
          ? latest.summaryBasis
          : force
            ? suggestion.summaryBasis
            : latest.summaryBasis || suggestion.summaryBasis,
        aiStatus: "ok",
        updatedAt: now(),
      })
      .where(
        and(
          eq(cards.id, cardId),
          eq(cards.updatedAt, latest.updatedAt),
          isNull(cards.deletedAt)
        )
      );
    if (updated.changes !== 1) {
      queueEnrichment(cardId, { force });
      return;
    }
  } catch (e) {
    const current = await db.select().from(cards).where(eq(cards.id, cardId)).get();
    if (!current || current.deletedAt) return;
    let prevRaw: Record<string, unknown> = {};
    try {
      prevRaw = current.rawMeta ? JSON.parse(current.rawMeta) : {};
    } catch {
      prevRaw = {};
    }
    await db
      .update(cards)
      .set({
        aiStatus: "failed",
        rawMeta: serializeRawMeta({
          ...prevRaw,
          aiError: String(e),
        }),
        updatedAt: now(),
      })
      .where(eq(cards.id, cardId));
    throw e;
  }

  if (fetchFailure) throw fetchFailure;
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
  const requestedLimit = Number.isFinite(query.limit) ? Math.floor(query.limit!) : 100;
  const requestedOffset = Number.isFinite(query.offset) ? Math.floor(query.offset!) : 0;
  const limit = Math.max(1, Math.min(requestedLimit, 200));
  const offset = Math.max(0, requestedOffset);

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

  if (query.q?.trim()) {
    const raw = query.q.trim().slice(0, 200);
    const terms = raw
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .split(/\s+/)
      .map((term) => term.replace(/"/g, '""'))
      .filter(Boolean);
    // LIKE is retained for CJK substring search, but user input is literal:
    // `%` and `_` must not silently expand to database wildcards.
    const likePattern = `%${raw
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_")}%`;
    const substringMatch = or(
      sql`${cards.title} LIKE ${likePattern} ESCAPE '\\'`,
      sql`${cards.summary} LIKE ${likePattern} ESCAPE '\\'`,
      sql`${cards.note} LIKE ${likePattern} ESCAPE '\\'`,
      sql`${cards.author} LIKE ${likePattern} ESCAPE '\\'`,
      sql`${cards.url} LIKE ${likePattern} ESCAPE '\\'`,
      sql`${cards.description} LIKE ${likePattern} ESCAPE '\\'`,
      sql`${cards.contentExcerpt} LIKE ${likePattern} ESCAPE '\\'`
    )!;
    if (terms.length > 0) {
      const ftsQuery = terms.map((term) => `"${term}"`).join(" AND ");
      conditions.push(
        or(
          sql`${cards.id} IN (
            SELECT card_id FROM cards_fts WHERE cards_fts MATCH ${ftsQuery}
          )`,
          substringMatch
        )!
      );
    } else {
      conditions.push(substringMatch);
    }
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

  const categoryRows = await db.select().from(categories).all();
  const categoryNames = new Map(categoryRows.map((category) => [category.id, category.name]));
  const items = await Promise.all(rows.map((row) => toFlashCard(row, categoryNames)));
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
  let urlChanged = false;
  if (patch.title !== undefined) {
    updates.title = patch.title;
    updates.titleLocked = 1;
  }
  if (patch.author !== undefined) {
    updates.author = patch.author;
    updates.authorLocked = 1;
  }
  if (patch.note !== undefined) updates.note = patch.note;
  if (patch.categoryId !== undefined) {
    updates.categoryId = patch.categoryId;
    updates.categoryLocked = 1;
  }
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.platform !== undefined) updates.platform = patch.platform;
  if (patch.url !== undefined) {
    const parsedUrl = patch.url ? parseHttpUrl(patch.url) : null;
    const normalized = parsedUrl ? normalizeUrl(parsedUrl) : null;
    urlChanged = normalized !== row.urlNormalized;
    updates.url = parsedUrl;
    updates.urlNormalized = normalized;
    if (parsedUrl) updates.platform = detectPlatform(parsedUrl);
    if (urlChanged) {
      updates.fetchStatus = parsedUrl ? "pending" : "skipped";
      updates.aiStatus = "pending";
      updates.thumbnailKey = null;
      updates.mediaJson = null;
      updates.description = null;
      updates.contentExcerpt = !parsedUrl && patch.note
        ? patch.note.slice(0, 6000)
        : null;
      updates.summary = null;
      updates.summaryBasis = null;
      updates.rawMeta = null;
    }
  }

  await db.update(cards).set(updates).where(eq(cards.id, id));
  if (urlChanged) {
    await deleteThumbnailByKey(row.thumbnailKey);
    queueEnrichment(id);
  }

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
  const card = await getCard(id);
  if (card && (card.fetchStatus === "pending" || card.aiStatus === "pending")) {
    queueEnrichment(id);
  }
  return card;
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

  await db.delete(cards).where(eq(cards.id, id));
  await deleteThumbnailByKey(row.thumbnailKey);
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
  const needsAuthor = !row.author && !row.authorLocked;
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
  media?: CardMediaItem[] | null;
  raw?: unknown;
}): Promise<"imported" | "claimed" | "already" | "skipped"> {
  const url = parseHttpUrl(input.url.trim());
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
    mediaJson: input.media?.length ? JSON.stringify(input.media) : null,
    note: null,
    categoryId: null,
    status: "inbox",
    // Timeline imports already contain the canonical body/media. Avoid a second
    // per-card X request; AI enrichment still runs from this captured evidence.
    fetchStatus: title || contentExcerpt || input.media?.length ? "ok" : "pending",
    aiStatus: hasAi ? "pending" : "skipped",
    summary: null,
    description: null,
    contentExcerpt,
    summaryBasis: null,
    rawMeta: input.raw ? serializeRawMeta({ import: input.raw }) : null,
    importSource: input.importSource,
    externalId,
    depositedAt: null,
    depositedObjectKey: null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  });

  queueEnrichment(id);
  return "imported";
}

export async function appendNote(id: string, note: string): Promise<FlashCard | null> {
  if (!appendNoteTransaction(id, note, false)) return null;
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
  if (!minio) {
    throw new AppError(
      "MINIO_NOT_CONFIGURED",
      422,
      "请先配置 MinIO / Obsidian 存储"
    );
  }

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

  // Once delivered, keep overwriting the same object. A later title edit must
  // not strand an older Markdown file under a second key.
  const key =
    card.depositedObjectKey ||
    vaultObjectKey(card.id, card.title, minio.vaultPrefix);
  let ok: string | null;
  try {
    ok = await uploadVaultMarkdown(key, md);
  } catch {
    throw new AppError("MINIO_UPLOAD_FAILED", 503, "Markdown 导出失败，请稍后重试");
  }
  if (!ok) {
    throw new AppError("MINIO_UPLOAD_FAILED", 503, "Markdown 导出失败，请稍后重试");
  }

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
  const cats = await db.select().from(categories).all();
  const categoryNames = new Map(cats.map((category) => [category.id, category.name]));
  const items = await Promise.all(rows.map((row) => toFlashCard(row, categoryNames)));
  return {
    exportedAt: new Date().toISOString(),
    categories: cats,
    cards: items,
  };
}
