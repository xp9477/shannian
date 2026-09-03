import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import test from "node:test";

// Bootstrap a database that looks like the previous application schema: it has
// all current card columns, but its FTS table has only the old five fields.
// `initDb` must rebuild it exactly once, without touching any user database.
const temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shannian-cards-test-"));
const dbPath = path.join(temporaryDataDir, "shannian.db");
const bootstrap = new Database(dbPath);
bootstrap.exec(`
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE categories (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    url TEXT, url_normalized TEXT, platform TEXT, title TEXT, author TEXT,
    thumbnail_key TEXT, media_json TEXT, note TEXT, category_id TEXT,
    status TEXT NOT NULL DEFAULT 'inbox',
    fetch_status TEXT NOT NULL DEFAULT 'pending', ai_status TEXT NOT NULL DEFAULT 'pending',
    summary TEXT, description TEXT, content_excerpt TEXT, summary_basis TEXT,
    raw_meta TEXT, import_source TEXT, external_id TEXT,
    deposited_at INTEGER, deposited_object_key TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
  );
  CREATE VIRTUAL TABLE cards_fts USING fts5(
    card_id UNINDEXED, title, note, author, url, tokenize = 'unicode61'
  );
`);
const legacyTime = Date.now() - 1_000;
bootstrap
  .prepare(
    `INSERT INTO cards (
      id, url, url_normalized, title, status, fetch_status, ai_status,
      summary, description, content_excerpt, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'inbox', 'done', 'done', ?, ?, ?, ?, ?)`
  )
  .run(
    "legacy-search",
    "https://example.test/legacy",
    "https://example.test/legacy",
    "old title",
    "needle-summary-before-upgrade",
    "old description",
    "needle-excerpt-before-upgrade",
    legacyTime,
    legacyTime
  );
bootstrap.close();

const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = temporaryDataDir;

const { initDb, sqlite } = await import("../db/index.js");
const { detectPlatform } = await import("../lib/url.js");
const { createCard, getCard, listCards, restoreCard, softDeleteCard, updateCard } =
  await import("./cards.js");

initDb();

function rawCard(id: string, patch: Partial<Record<string, unknown>> = {}): void {
  const timestamp = Date.now();
  const values = {
    id,
    status: "inbox",
    fetchStatus: "done",
    aiStatus: "done",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...patch,
  };
  sqlite
    .prepare(
      `INSERT INTO cards (
        id, url, url_normalized, platform, title, author, thumbnail_key, media_json,
        note, category_id, status, fetch_status, ai_status, summary, description,
        content_excerpt, summary_basis, raw_meta, import_source, external_id,
        deposited_at, deposited_object_key, created_at, updated_at, deleted_at
      ) VALUES (
        @id, @url, @urlNormalized, @platform, @title, @author, @thumbnailKey, @mediaJson,
        @note, @categoryId, @status, @fetchStatus, @aiStatus, @summary, @description,
        @contentExcerpt, @summaryBasis, @rawMeta, @importSource, @externalId,
        @depositedAt, @depositedObjectKey, @createdAt, @updatedAt, @deletedAt
      )`
    )
    .run({
      ...values,
      url: null,
      urlNormalized: null,
      platform: null,
      title: null,
      author: null,
      thumbnailKey: null,
      mediaJson: null,
      note: null,
      categoryId: null,
      summary: null,
      description: null,
      contentExcerpt: null,
      summaryBasis: null,
      rawMeta: null,
      importSource: null,
      externalId: null,
      depositedAt: null,
      depositedObjectKey: null,
      deletedAt: null,
      ...values,
    });
}

test("migration rebuilds old FTS once and its triggers index AI evidence", async () => {
  try {
    assert.equal(
      sqlite
        .prepare("SELECT 1 FROM schema_migrations WHERE id = '2026-08-15-search-index-v2'")
        .get() != null,
      true
    );
    assert.equal((await listCards({ q: "needle-summary-before-upgrade" })).total, 1);
    assert.equal((await listCards({ q: "needle-excerpt-before-upgrade" })).total, 1);
    assert.deepEqual(
      sqlite
        .prepare(
          "SELECT title_locked, author_locked, category_locked FROM cards WHERE id = ?"
        )
        .get("legacy-search"),
      { title_locked: 1, author_locked: 0, category_locked: 0 }
    );

    sqlite
      .prepare("UPDATE cards SET summary = ?, content_excerpt = ? WHERE id = ?")
      .run("replacement-summary", "replacement-excerpt", "legacy-search");
    assert.equal((await listCards({ q: "needle-summary-before-upgrade" })).total, 0);
    assert.equal((await listCards({ q: "replacement-summary" })).total, 1);
    assert.equal((await listCards({ q: "replacement-excerpt" })).total, 1);

    // A second initialization must not recreate/drop the virtual table or lose data.
    initDb();
    assert.equal((await listCards({ q: "replacement-summary" })).total, 1);
  } catch (error) {
    assert.fail(error instanceof Error ? error.message : String(error));
  }
});

test("manual title, author, and category edits lock those fields against enrichment", async () => {
  const created = await createCard({ url: "https://example.test/manual-fields" });
  const category = sqlite
    .prepare("SELECT id FROM categories ORDER BY sort_order, id LIMIT 1")
    .get() as { id: string };

  await updateCard(created.card.id, {
    title: "user title",
    author: "user author",
    categoryId: category.id,
  });

  assert.deepEqual(
    sqlite
      .prepare(
        `SELECT title, title_locked, author, author_locked, category_id, category_locked
         FROM cards WHERE id = ?`
      )
      .get(created.card.id),
    {
      title: "user title",
      title_locked: 1,
      author: "user author",
      author_locked: 1,
      category_id: category.id,
      category_locked: 1,
    }
  );
});

test("URL creation is idempotent under races and input boundaries are constrained", async () => {
  const inputUrl = "https://example.test/one?utm_source=test&a=1";
  const attempts = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      createCard({ url: inputUrl, note: `concurrent-${index}` })
    )
  );
  const ids = new Set(attempts.map((attempt) => attempt.card.id));
  assert.equal(ids.size, 1);
  assert.equal(attempts.filter((attempt) => !attempt.existing).length, 1);
  const createdId = attempts[0]!.card.id;
  const stored = await getCard(createdId);
  assert.ok(stored?.note?.includes("concurrent-"));

  await assert.rejects(createCard({ url: "file:///etc/passwd" }), /INVALID_URL/);
  await assert.rejects(createCard({ url: "https://user:secret@example.test/private" }), /INVALID_URL/);
  await assert.rejects(createCard({ url: "ftp://example.test/file" }), /INVALID_URL/);

  assert.equal(detectPlatform("https://space.bilibili.com/1"), "bilibili");
  assert.equal(detectPlatform("https://evilbilibili.com/video"), "web");
  assert.equal(detectPlatform("https://youtube.com.attacker.test/watch?v=1"), "web");
  assert.equal(detectPlatform("https://not-t.me.example.test/message"), "web");

  rawCard("pagination-one");
  rawCard("pagination-two");
  assert.equal((await listCards({ limit: -10, offset: -99 })).items.length, 1);
  assert.equal((await listCards({ limit: 9_999, offset: -1 })).items.length <= 200, true);

  rawCard("literal-percent", { title: "discount 100% today" });
  rawCard("wildcard-percent-control", { title: "discount 100x today" });
  assert.deepEqual(
    (await listCards({ q: "%" })).items.map((card) => card.id),
    ["literal-percent"]
  );
  rawCard("literal-underscore", { title: "needle_value" });
  rawCard("wildcard-underscore-control", { title: "needleXvalue" });
  const underscoreMatches = (await listCards({ q: "_" })).items.map((card) => card.id);
  assert.ok(underscoreMatches.includes("literal-underscore"));
  assert.equal(underscoreMatches.includes("wildcard-underscore-control"), false);
});

test("changing a URL clears derived state, persists work, and restore requeues pending cards", async () => {
  const created = await createCard({ url: "https://example.test/derived" });
  const id = created.card.id;
  sqlite
    .prepare(
      `UPDATE cards
       SET thumbnail_key = 'thumbs/old.jpg', media_json = '[{"type":"image","url":"https://x"}]',
           description = 'old description', content_excerpt = 'old body', summary = 'old summary',
           summary_basis = 'content', raw_meta = '{"old":true}', fetch_status = 'ok', ai_status = 'ok'
       WHERE id = ?`
    )
    .run(id);

  const changed = await updateCard(id, { url: "https://example.test/replaced" });
  assert.equal(changed?.url, "https://example.test/replaced");
  const cleared = sqlite
    .prepare(
      `SELECT thumbnail_key, media_json, description, content_excerpt, summary, summary_basis,
              raw_meta, fetch_status, ai_status
       FROM cards WHERE id = ?`
    )
    .get(id) as Record<string, unknown>;
  assert.deepEqual(cleared, {
    thumbnail_key: null,
    media_json: null,
    description: null,
    content_excerpt: null,
    summary: null,
    summary_basis: null,
    raw_meta: null,
    fetch_status: "pending",
    ai_status: "pending",
  });
  assert.equal(
    sqlite.prepare("SELECT status FROM enrichment_jobs WHERE card_id = ?").get(id) != null,
    true
  );

  await softDeleteCard(id);
  sqlite.prepare("DELETE FROM enrichment_jobs WHERE card_id = ?").run(id);
  const restored = await restoreCard(id);
  assert.equal(restored?.deletedAt, null);
  assert.equal(
    sqlite.prepare("SELECT status FROM enrichment_jobs WHERE card_id = ?").get(id) != null,
    true
  );
});

test("database guard rails reject invalid status/category and duplicate source identities", () => {
  assert.throws(() => rawCard("bad-status", { status: "surprise" }), /invalid card status/);
  assert.throws(
    () => rawCard("bad-category", { categoryId: "missing-category" }),
    /invalid card category/
  );
  rawCard("external-one", { importSource: "x", externalId: "same-id" });
  assert.throws(
    () => rawCard("external-two", { importSource: "x", externalId: "same-id" }),
    /duplicate external identity/
  );
});

test("stored remote media is sanitized before it reaches the browser", async () => {
  rawCard("unsafe-media", {
    mediaJson: JSON.stringify([
      { type: "image", url: "javascript:alert(1)" },
      { type: "video", url: "https://cdn.example.test/video.mp4", posterUrl: "data:x" },
    ]),
  });
  const card = await getCard("unsafe-media");
  assert.deepEqual(card?.media, [
    {
      type: "video",
      url: "https://cdn.example.test/video.mp4",
      posterUrl: null,
      width: null,
      height: null,
    },
  ]);
});

test.after(() => {
  sqlite.close();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(temporaryDataDir, { recursive: true, force: true });
});
