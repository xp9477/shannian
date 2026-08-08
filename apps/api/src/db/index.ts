import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema.js";
import { DEFAULT_CATEGORIES } from "@shannian/shared";
import { nanoid } from "nanoid";

const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "../../data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "shannian.db");

/** SQLite + local thumbs live under this directory. */
export function getDataDir(): string {
  return dataDir;
}

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export function initDb() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      url TEXT,
      url_normalized TEXT,
      platform TEXT,
      title TEXT,
      author TEXT,
      thumbnail_key TEXT,
      media_json TEXT,
      note TEXT,
      category_id TEXT,
      status TEXT NOT NULL DEFAULT 'inbox',
      fetch_status TEXT NOT NULL DEFAULT 'pending',
      ai_status TEXT NOT NULL DEFAULT 'pending',
      summary TEXT,
      description TEXT,
      content_excerpt TEXT,
      summary_basis TEXT,
      raw_meta TEXT,
      import_source TEXT,
      external_id TEXT,
      deposited_at INTEGER,
      deposited_object_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cards_url_normalized_unique
      ON cards(url_normalized) WHERE url_normalized IS NOT NULL AND deleted_at IS NULL;
  `);

  // Lightweight migrations for existing installs
  const cardCols = (
    sqlite.prepare("PRAGMA table_info(cards)").all() as { name: string }[]
  ).map((c) => c.name);
  if (!cardCols.includes("description")) {
    sqlite.exec("ALTER TABLE cards ADD COLUMN description TEXT");
  }
  if (!cardCols.includes("content_excerpt")) {
    sqlite.exec("ALTER TABLE cards ADD COLUMN content_excerpt TEXT");
  }
  if (!cardCols.includes("summary_basis")) {
    sqlite.exec("ALTER TABLE cards ADD COLUMN summary_basis TEXT");
  }
  if (!cardCols.includes("import_source")) {
    sqlite.exec("ALTER TABLE cards ADD COLUMN import_source TEXT");
  }
  if (!cardCols.includes("external_id")) {
    sqlite.exec("ALTER TABLE cards ADD COLUMN external_id TEXT");
  }
  if (!cardCols.includes("media_json")) {
    sqlite.exec("ALTER TABLE cards ADD COLUMN media_json TEXT");
  }
  sqlite.exec(
    "CREATE INDEX IF NOT EXISTS cards_external_id_idx ON cards(import_source, external_id)"
  );

  // K1/D2: remove tags entirely (data + FTS column)
  migrateDropTags();

  const count = sqlite.prepare("SELECT COUNT(*) as c FROM categories").get() as { c: number };
  if (count.c === 0) {
    const now = Date.now();
    const insert = sqlite.prepare(
      "INSERT INTO categories (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)"
    );
    const tx = sqlite.transaction(() => {
      DEFAULT_CATEGORIES.forEach((name, i) => {
        insert.run(nanoid(), name, i, now);
      });
    });
    tx();
  }
}

/** Drop tags tables and rebuild FTS without tags column (idempotent). */
function migrateDropTags() {
  const tables = (
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[]
  ).map((t) => t.name);

  if (tables.includes("card_tags")) {
    sqlite.exec("DROP TABLE card_tags");
  }
  if (tables.includes("tags")) {
    sqlite.exec("DROP TABLE tags");
  }

  // Detect old FTS schema (has tags column) via shadow table or recreate once
  const ftsExists = tables.includes("cards_fts");
  let needsFtsRebuild = !ftsExists;
  if (ftsExists) {
    try {
      // Old FTS had a tags column — probing fails if schema mismatch after DROP rewrite
      const info = sqlite
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cards_fts'")
        .get() as { sql: string } | undefined;
      if (info?.sql?.includes("tags")) {
        needsFtsRebuild = true;
      }
    } catch {
      needsFtsRebuild = true;
    }
  }

  if (needsFtsRebuild) {
    sqlite.exec("DROP TABLE IF EXISTS cards_fts");
    sqlite.exec(`
      CREATE VIRTUAL TABLE cards_fts USING fts5(
        card_id UNINDEXED,
        title,
        note,
        author,
        url,
        tokenize = 'unicode61'
      );
    `);
    sqlite.exec(`
      INSERT INTO cards_fts (card_id, title, note, author, url)
      SELECT
        id,
        COALESCE(title, ''),
        COALESCE(note, ''),
        COALESCE(author, ''),
        COALESCE(url, '')
      FROM cards;
    `);
    console.log("[db] rebuilt cards_fts without tags");
  } else if (!ftsExists) {
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
        card_id UNINDEXED,
        title,
        note,
        author,
        url,
        tokenize = 'unicode61'
      );
    `);
  }
}

export { sqlite };
