import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    url: text("url"),
    urlNormalized: text("url_normalized"),
    platform: text("platform"),
    title: text("title"),
    titleLocked: integer("title_locked").notNull().default(0),
    author: text("author"),
    authorLocked: integer("author_locked").notNull().default(0),
    thumbnailKey: text("thumbnail_key"),
    /** JSON array of CardMediaItem */
    mediaJson: text("media_json"),
    note: text("note"),
    categoryId: text("category_id"),
    categoryLocked: integer("category_locked").notNull().default(0),
    status: text("status").notNull().default("inbox"),
    fetchStatus: text("fetch_status").notNull().default("pending"),
    aiStatus: text("ai_status").notNull().default("pending"),
    summary: text("summary"),
    description: text("description"),
    contentExcerpt: text("content_excerpt"),
    summaryBasis: text("summary_basis"),
    rawMeta: text("raw_meta"),
    importSource: text("import_source"),
    externalId: text("external_id"),
    depositedAt: integer("deposited_at"),
    depositedObjectKey: text("deposited_object_key"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    uniqueIndex("cards_url_normalized_unique")
      .on(t.urlNormalized)
      .where(sql`${t.urlNormalized} is not null and ${t.deletedAt} is null`),
  ]
);
