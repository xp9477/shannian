import { Hono } from "hono";
import { z } from "zod";
import { hashPassword } from "../lib/crypto.js";
import {
  getAiSettingsPublic,
  getMinioSettingsPublic,
  getSetupStatus,
  setSetting,
} from "../lib/settings.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { setCookie } from "hono/cookie";
import { generateToken, hashToken } from "../lib/crypto.js";
import { db } from "../db/index.js";
import { sessions } from "../db/schema.js";
import { nanoid } from "nanoid";

export const setupRoutes = new Hono<AuthEnv>();

setupRoutes.get("/status", async (c) => {
  const status = await getSetupStatus();
  return c.json(status);
});

setupRoutes.post("/password", async (c) => {
  const status = await getSetupStatus();
  if (status.initialized) {
    return c.json({ error: "ALREADY_INITIALIZED" }, 400);
  }
  const body = z.object({ password: z.string().min(8) }).parse(await c.req.json());
  await setSetting("password_hash", await hashPassword(body.password));

  // auto login
  const token = generateToken();
  const id = nanoid();
  const now = Date.now();
  await db.insert(sessions).values({
    id,
    tokenHash: hashToken(token),
    expiresAt: now + 30 * 864e5,
    createdAt: now,
  });
  setCookie(c, "shannian_session", token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 86400,
  });

  return c.json({ ok: true });
});

setupRoutes.post("/ai", requireAuth, async (c) => {
  const body = z
    .object({
      baseUrl: z.string().url(),
      apiKey: z.string().min(1),
      model: z.string().min(1),
    })
    .parse(await c.req.json());
  await setSetting("ai_base_url", body.baseUrl.replace(/\/$/, ""));
  await setSetting("ai_api_key", body.apiKey);
  await setSetting("ai_model", body.model);
  return c.json({ ok: true, ai: await getAiSettingsPublic() });
});

setupRoutes.post("/minio", requireAuth, async (c) => {
  const body = z
    .object({
      endpoint: z.string().min(1),
      bucket: z.string().min(1),
      accessKey: z.string().min(1),
      secretKey: z.string().min(1),
      region: z.string().optional(),
      thumbsPrefix: z.string().optional(),
      vaultPrefix: z.string().optional(),
    })
    .parse(await c.req.json());
  await setSetting("minio_endpoint", body.endpoint);
  await setSetting("minio_bucket", body.bucket);
  await setSetting("minio_access_key", body.accessKey);
  await setSetting("minio_secret_key", body.secretKey);
  if (body.region) await setSetting("minio_region", body.region);
  if (body.thumbsPrefix) await setSetting("minio_thumbs_prefix", body.thumbsPrefix);
  if (body.vaultPrefix) await setSetting("minio_vault_prefix", body.vaultPrefix);
  return c.json({ ok: true, minio: await getMinioSettingsPublic() });
});

setupRoutes.post("/skip-ai", requireAuth, async (c) => {
  await setSetting("setup_ai_skipped", "1");
  return c.json({ ok: true });
});

setupRoutes.post("/skip-minio", requireAuth, async (c) => {
  await setSetting("setup_minio_skipped", "1");
  return c.json({ ok: true });
});
