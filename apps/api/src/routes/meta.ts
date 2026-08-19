import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { db, sqlite } from "../db/index.js";
import { categories } from "../db/schema.js";
import {
  getAiSettingsPublic,
  getMinioSettingsPublic,
  getSetupStatus,
  setSettings,
} from "../lib/settings.js";
import { getHttpProxyPublic, setHttpProxyUrl, testHttpProxy } from "../lib/http.js";
import { testAiConnection } from "../services/ai.js";
import { testMinioConnection } from "../services/minio.js";
import * as cardsService from "../services/cards.js";
import { readThumbnail } from "../services/thumbs.js";
import {
  aiBaseUrlSchema,
  minioEndpointSchema,
  normalizeAiBaseUrl,
  normalizeMinioEndpoint,
  settingValueSchema,
  shortTextSchema,
} from "../lib/validation.js";

export const metaRoutes = new Hono<AuthEnv>();

metaRoutes.get("/media/:key{.+}", requireAuth, async (c) => {
  try {
    const key = decodeURIComponent(c.req.param("key"));
    const local = await readThumbnail(key);
    if (!local) return c.json({ error: "NOT_FOUND" }, 404);
    return new Response(local.stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": local.contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return c.json({ error: "NOT_FOUND" }, 404);
  }
});

const authed = new Hono<AuthEnv>();
authed.use("*", requireAuth);

authed.get("/categories", async (c) => {
  const rows = await db.select().from(categories).all();
  rows.sort((a, b) => a.sortOrder - b.sortOrder);
  return c.json({
    items: rows.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sortOrder })),
  });
});

authed.post("/categories", async (c) => {
  const body = z
    .object({ name: shortTextSchema.trim().min(1).max(100) })
    .strict()
    .parse(await c.req.json());
  const id = nanoid();
  const count = (await db.select().from(categories).all()).length;
  await db.insert(categories).values({
    id,
    name: body.name.trim(),
    sortOrder: count,
    createdAt: Date.now(),
  });
  return c.json({ id, name: body.name.trim() }, 201);
});

authed.patch("/categories/:id", async (c) => {
  const body = z
    .object({ name: shortTextSchema.trim().min(1).max(100) })
    .strict()
    .parse(await c.req.json());
  await db
    .update(categories)
    .set({ name: body.name.trim() })
    .where(eq(categories.id, c.req.param("id")));
  return c.json({ ok: true });
});

authed.delete("/categories/:id", async (c) => {
  const id = c.req.param("id");
  const removeCategory = sqlite.transaction(() => {
    sqlite
      .prepare("UPDATE cards SET category_id = NULL, updated_at = ? WHERE category_id = ?")
      .run(Date.now(), id);
    sqlite.prepare("DELETE FROM categories WHERE id = ?").run(id);
  });
  removeCategory();
  return c.json({ ok: true });
});

authed.get("/review/inbox-count", async (c) => {
  return c.json({ count: await cardsService.inboxCount() });
});

authed.get("/review/random", async (c) => {
  const card = await cardsService.randomReviewCard();
  return c.json({ card });
});

authed.get("/settings", async (c) => {
  return c.json({
    setup: await getSetupStatus(),
    ai: await getAiSettingsPublic(),
    minio: await getMinioSettingsPublic(),
    proxy: await getHttpProxyPublic(),
  });
});

authed.put("/settings/ai", async (c) => {
  const body = z
    .object({
      baseUrl: aiBaseUrlSchema,
      apiKey: settingValueSchema.optional(),
      model: shortTextSchema.min(1),
    }).strict()
    .parse(await c.req.json());
  await setSettings({
    ai_base_url: normalizeAiBaseUrl(body.baseUrl),
    ai_model: body.model,
    ai_api_key: body.apiKey || undefined,
  });
  return c.json({ ai: await getAiSettingsPublic() });
});

authed.put("/settings/minio", async (c) => {
  const body = z
    .object({
      endpoint: minioEndpointSchema,
      bucket: shortTextSchema.min(1),
      accessKey: settingValueSchema.optional(),
      secretKey: settingValueSchema.optional(),
      region: shortTextSchema.optional(),
      thumbsPrefix: shortTextSchema.optional(),
      vaultPrefix: shortTextSchema.optional(),
    }).strict()
    .parse(await c.req.json());
  await setSettings({
    minio_endpoint: normalizeMinioEndpoint(body.endpoint),
    minio_bucket: body.bucket,
    minio_access_key: body.accessKey || undefined,
    minio_secret_key: body.secretKey || undefined,
    minio_region: body.region || undefined,
    minio_thumbs_prefix: body.thumbsPrefix || undefined,
    minio_vault_prefix: body.vaultPrefix || undefined,
  });
  return c.json({ minio: await getMinioSettingsPublic() });
});

authed.put("/settings/proxy", async (c) => {
  const body = z
    .object({
      /** Empty string clears settings proxy (env may still apply) */
      proxyUrl: settingValueSchema,
    }).strict()
    .parse(await c.req.json());
  try {
    await setHttpProxyUrl(body.proxyUrl.trim() ? body.proxyUrl : null);
  } catch (e) {
    return c.json(
      { error: "INVALID_PROXY", message: e instanceof Error ? e.message : String(e) },
      400
    );
  }
  return c.json({ proxy: await getHttpProxyPublic() });
});

authed.post("/settings/ai/test", async (c) => {
  return c.json(await testAiConnection());
});

authed.post("/settings/minio/test", async (c) => {
  return c.json(await testMinioConnection());
});

authed.post("/settings/proxy/test", async (c) => {
  return c.json(await testHttpProxy());
});

authed.get("/export", async (c) => {
  const data = await cardsService.exportAllJson();
  return c.json(data);
});

metaRoutes.route("/", authed);
