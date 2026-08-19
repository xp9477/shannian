import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import * as cardsService from "../services/cards.js";
import {
  cardTextSchema,
  cardUrlSchema,
  shortTextSchema,
} from "../lib/validation.js";

export const cardsRoutes = new Hono<AuthEnv>();
cardsRoutes.use("*", requireAuth);

cardsRoutes.get("/", async (c) => {
  const q = z
    .object({
      q: z.string().max(200).optional(),
      status: z.enum(["all", "inbox", "organized", "deposited"]).default("all"),
      categoryId: z.string().max(128).optional(),
      platform: z.string().max(32).optional(),
      thoughtsOnly: z.enum(["0", "1"]).optional(),
      linksOnly: z.enum(["0", "1"]).optional(),
      incomplete: z.enum(["0", "1"]).optional(),
      aiFailed: z.enum(["0", "1"]).optional(),
      trash: z.enum(["0", "1"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    })
    .parse(c.req.query());
  const result = await cardsService.listCards({
    q: q.q,
    status: q.status,
    categoryId: q.categoryId,
    platform: q.platform,
    thoughtsOnly: q.thoughtsOnly === "1",
    linksOnly: q.linksOnly === "1",
    incomplete: q.incomplete === "1",
    aiFailed: q.aiFailed === "1",
    trash: q.trash === "1",
    limit: q.limit,
    offset: q.offset,
  });
  return c.json(result);
});

cardsRoutes.post("/bulk", async (c) => {
  const body = z
    .object({
      ids: z.array(z.string().min(1).max(128)).min(1).max(200),
      action: z.enum(["organize", "trash", "retry"]),
    }).strict()
    .parse(await c.req.json());
  const result = await cardsService.bulkCards(body.ids, body.action);
  return c.json(result);
});

cardsRoutes.post("/", async (c) => {
  const body = z
    .object({
      text: cardTextSchema.optional(),
      url: cardUrlSchema.nullable().optional(),
      note: cardTextSchema.nullable().optional(),
    }).strict()
    .parse(await c.req.json());
  try {
    const result = await cardsService.createCard(body);
    return c.json(result, result.existing ? 200 : 201);
  } catch (e) {
    if (e instanceof Error && e.message === "EMPTY_CARD") {
      return c.json({ error: "EMPTY_CARD" }, 400);
    }
    throw e;
  }
});

// Note: /bulk is registered above /:id so it is not captured as an id.

cardsRoutes.get("/:id", async (c) => {
  const card = await cardsService.getCard(c.req.param("id"));
  if (!card) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ card });
});

cardsRoutes.patch("/:id", async (c) => {
  const body = z
    .object({
      title: shortTextSchema.nullable().optional(),
      author: shortTextSchema.nullable().optional(),
      note: cardTextSchema.nullable().optional(),
      url: cardUrlSchema.nullable().optional(),
      categoryId: z.string().max(128).nullable().optional(),
      status: z.enum(["inbox", "organized", "deposited"]).optional(),
      platform: z
        .enum([
          "xiaohongshu",
          "douyin",
          "bilibili",
          "youtube",
          "x",
          "telegram",
          "web",
          "unknown",
        ])
        .nullable()
        .optional(),
    }).strict()
    .parse(await c.req.json());
  const card = await cardsService.updateCard(c.req.param("id"), body);
  if (!card) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ card });
});

cardsRoutes.post("/:id/append-note", async (c) => {
  const body = z
    .object({ note: cardTextSchema.min(1) })
    .strict()
    .parse(await c.req.json());
  const card = await cardsService.appendNote(c.req.param("id"), body.note);
  if (!card) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ card });
});

cardsRoutes.post("/:id/retry-enrich", async (c) => {
  const id = c.req.param("id");
  const existing = await cardsService.getCard(id);
  if (!existing) return c.json({ error: "NOT_FOUND" }, 404);
  // force: re-fetch page + full AI overwrite (confirmed product rule)
  await cardsService.markEnrichPending(id);
  cardsService.queueEnrichment(id, { force: true });
  const card = await cardsService.getCard(id);
  return c.json({ card, queued: true });
});

cardsRoutes.post("/:id/obsidian", async (c) => {
  const card = await cardsService.exportObsidian(c.req.param("id"));
  if (!card) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ card });
});

cardsRoutes.delete("/:id", async (c) => {
  const permanent = c.req.query("permanent") === "1";
  const force = c.req.query("force") === "1";
  if (permanent) {
    const result = await cardsService.purgeCard(c.req.param("id"), { force });
    if (!result.ok) {
      return c.json(
        { error: result.error, message: result.message, ok: false },
        409
      );
    }
  } else {
    await cardsService.softDeleteCard(c.req.param("id"));
  }
  return c.json({ ok: true });
});

cardsRoutes.post("/:id/restore", async (c) => {
  const card = await cardsService.restoreCard(c.req.param("id"));
  if (!card) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ card });
});
