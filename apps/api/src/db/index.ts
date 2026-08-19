import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema.js";
import { DEFAULT_CATEGORIES } from "@shannian/shared";
import { nanoid } from "nanoid";

// Secrets and private content live beside SQLite. New files must never inherit a
// permissive NAS/container umask.
process.umask(0o077);

const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "../../data");
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
try {
  fs.chmodSync(dataDir, 0o700);
} catch {
  // Read-only mounts will fail later with a clearer SQLite error.
}
const dbPath = path.join(dataDir, "shannian.db");

/** SQLite + local thumbs live under this directory. */
export function getDataDir(): string {
  return dataDir;
}

const sqlite = new Database(dbPath);
try {
  fs.chmodSync(dbPath, 0o600);
} catch {
  // Best effort for filesystems without POSIX permissions.
}
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

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
      title_locked INTEGER NOT NULL DEFAULT 0,
      author TEXT,
      author_locked INTEGER NOT NULL DEFAULT 0,
      thumbnail_key TEXT,
      media_json TEXT,
      note TEXT,
      category_id TEXT,
      category_locked INTEGER NOT NULL DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS enrichment_jobs (
      card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'failed')),
      force INTEGER NOT NULL DEFAULT 0 CHECK (force IN (0, 1)),
      version INTEGER NOT NULL DEFAULT 1,
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at INTEGER NOT NULL,
      locked_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS enrichment_jobs_ready_idx
      ON enrichment_jobs(status, available_at, created_at);
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
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
  if (!cardCols.includes("title_locked")) {
    sqlite.exec("ALTER TABLE cards ADD COLUMN title_locked INTEGER NOT NULL DEFAULT 0");
    // Existing provenance is unknowable. Preserve visible user data rather
    // than letting a later retry overwrite a possibly hand-edited title.
    sqlite.exec("UPDATE cards SET title_locked = 1 WHERE title IS NOT NULL");
  }
  if (!cardCols.includes("author_locked")) {
    sqlite.exec("ALTER TABLE cards ADD COLUMN author_locked INTEGER NOT NULL DEFAULT 0");
    sqlite.exec("UPDATE cards SET author_locked = 1 WHERE author IS NOT NULL");
  }
  if (!cardCols.includes("category_locked")) {
    sqlite.exec("ALTER TABLE cards ADD COLUMN category_locked INTEGER NOT NULL DEFAULT 0");
    sqlite.exec("UPDATE cards SET category_locked = 1 WHERE category_id IS NOT NULL");
  }
  sqlite.exec(
    "CREATE INDEX IF NOT EXISTS cards_external_id_idx ON cards(import_source, external_id)"
  );

  sqlite.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());

  runMigrations();

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

function runMigration(id: string, migrate: () => void): void {
  const applied = sqlite
    .prepare("SELECT 1 FROM schema_migrations WHERE id = ?")
    .get(id);
  if (applied) return;
  const transaction = sqlite.transaction(() => {
    migrate();
    sqlite
      .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
      .run(id, Date.now());
  });
  transaction();
  console.log(`[db] applied migration ${id}`);
}

function runMigrations() {
  runMigration("2026-08-15-search-index-v2", () => {
    sqlite.exec("DROP TRIGGER IF EXISTS cards_fts_after_insert");
    sqlite.exec("DROP TRIGGER IF EXISTS cards_fts_after_update");
    sqlite.exec("DROP TRIGGER IF EXISTS cards_fts_after_delete");
    sqlite.exec("DROP TABLE IF EXISTS cards_fts");
    sqlite.exec("DROP TABLE IF EXISTS card_tags");
    sqlite.exec("DROP TABLE IF EXISTS tags");
    sqlite.exec(`
      CREATE VIRTUAL TABLE cards_fts USING fts5(
        card_id UNINDEXED,
        title,
        summary,
        note,
        author,
        url,
        description,
        content_excerpt,
        tokenize = 'unicode61'
      );

      INSERT INTO cards_fts (
        card_id, title, summary, note, author, url, description, content_excerpt
      )
      SELECT
        id,
        COALESCE(title, ''),
        COALESCE(summary, ''),
        COALESCE(note, ''),
        COALESCE(author, ''),
        COALESCE(url, ''),
        COALESCE(description, ''),
        COALESCE(content_excerpt, '')
      FROM cards;

      CREATE TRIGGER cards_fts_after_insert AFTER INSERT ON cards BEGIN
        INSERT INTO cards_fts (
          card_id, title, summary, note, author, url, description, content_excerpt
        ) VALUES (
          new.id,
          COALESCE(new.title, ''),
          COALESCE(new.summary, ''),
          COALESCE(new.note, ''),
          COALESCE(new.author, ''),
          COALESCE(new.url, ''),
          COALESCE(new.description, ''),
          COALESCE(new.content_excerpt, '')
        );
      END;

      CREATE TRIGGER cards_fts_after_update AFTER UPDATE OF
        title, summary, note, author, url, description, content_excerpt ON cards BEGIN
        DELETE FROM cards_fts WHERE card_id = old.id;
        INSERT INTO cards_fts (
          card_id, title, summary, note, author, url, description, content_excerpt
        ) VALUES (
          new.id,
          COALESCE(new.title, ''),
          COALESCE(new.summary, ''),
          COALESCE(new.note, ''),
          COALESCE(new.author, ''),
          COALESCE(new.url, ''),
          COALESCE(new.description, ''),
          COALESCE(new.content_excerpt, '')
        );
      END;

      CREATE TRIGGER cards_fts_after_delete AFTER DELETE ON cards BEGIN
        DELETE FROM cards_fts WHERE card_id = old.id;
      END;
    `);
  });

  runMigration("2026-08-15-card-integrity-guards-v1", () => {
    sqlite.exec(`
      CREATE TRIGGER cards_validate_status_insert
      BEFORE INSERT ON cards
      WHEN new.status NOT IN ('inbox', 'organized', 'deposited')
      BEGIN
        SELECT RAISE(ABORT, 'invalid card status');
      END;

      CREATE TRIGGER cards_validate_status_update
      BEFORE UPDATE OF status ON cards
      WHEN new.status NOT IN ('inbox', 'organized', 'deposited')
      BEGIN
        SELECT RAISE(ABORT, 'invalid card status');
      END;

      CREATE TRIGGER cards_validate_category_insert
      BEFORE INSERT ON cards
      WHEN new.category_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM categories WHERE id = new.category_id)
      BEGIN
        SELECT RAISE(ABORT, 'invalid card category');
      END;

      CREATE TRIGGER cards_validate_category_update
      BEFORE UPDATE OF category_id ON cards
      WHEN new.category_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM categories WHERE id = new.category_id)
      BEGIN
        SELECT RAISE(ABORT, 'invalid card category');
      END;

      CREATE TRIGGER cards_unique_external_insert
      BEFORE INSERT ON cards
      WHEN new.deleted_at IS NULL
        AND new.import_source IS NOT NULL
        AND new.external_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM cards
          WHERE deleted_at IS NULL
            AND import_source = new.import_source
            AND external_id = new.external_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'duplicate external identity');
      END;

      CREATE TRIGGER cards_unique_external_update
      BEFORE UPDATE OF import_source, external_id, deleted_at ON cards
      WHEN new.deleted_at IS NULL
        AND new.import_source IS NOT NULL
        AND new.external_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM cards
          WHERE id != new.id
            AND deleted_at IS NULL
            AND import_source = new.import_source
            AND external_id = new.external_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'duplicate external identity');
      END;
    `);
  });
}

export { sqlite };
