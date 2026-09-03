import { Hono } from "hono";
import { z } from "zod";
import { hashPassword } from "../lib/crypto.js";
import {
  getAiSettingsPublic,
  getMinioSettingsPublic,
  getSetupStatus,
  setSetting,
  setSettings,
} from "../lib/settings.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { setCookie } from "hono/cookie";
import { sessionCookieSecure } from "../lib/cookie.js";
import { generateToken, hashToken } from "../lib/crypto.js";
import { sqlite } from "../db/index.js";
import { nanoid } from "nanoid";
import {
  aiBaseUrlSchema,
  minioEndpointSchema,
  normalizeAiBaseUrl,
  normalizeMinioEndpoint,
  passwordSchema,
  settingValueSchema,
} from "../lib/validation.js";
import { verifySetupToken } from "../lib/setup-token.js";

export const setupRoutes = new Hono<AuthEnv>();

setupRoutes.get("/status", async (c) => {
  const status = await getSetupStatus();
  return c.json(status);
});

setupRoutes.post("/password", async (c) => {
  const status = await getSetupStatus();
  if (status.initialized) {
    return c.json({ error: "ALREADY_INITIALIZED" }, 409);
  }
  const body = z
    .object({ password: passwordSchema, setupToken: z.string().max(256).optional() })
    .strict()
    .parse(await c.req.json());
  const suppliedToken = c.req.header("x-setup-token") || body.setupToken;
  if (!verifySetupToken(suppliedToken)) {
    return c.json({ error: "INVALID_SETUP_TOKEN" }, 403);
  }

  // bcrypt intentionally runs before the short SQLite transaction. The primary-key
  // INSERT below is the atomic claim: concurrent losers never receive a session.
  const passwordHash = await hashPassword(body.password);

  // auto login
  const token = generateToken();
  const id = nanoid();
  const now = Date.now();
  const claimSetup = sqlite.transaction(() => {
    const claimed = sqlite
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('password_hash', ?)")
      .run(passwordHash);
    if (claimed.changes !== 1) return false;
    sqlite
      .prepare(
        "INSERT INTO sessions (id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(id, hashToken(token), now + 30 * 864e5, now);
    return true;
  });
  if (!claimSetup()) {
    return c.json({ error: "ALREADY_INITIALIZED" }, 409);
  }
  setCookie(c, "shannian_session", token, {
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 86400,
  });

  return c.json({ ok: true });
});

setupRoutes.post("/ai", requireAuth, async (c) => {
  const body = z
    .object({
      baseUrl: aiBaseUrlSchema,
      apiKey: settingValueSchema.min(1),
      model: settingValueSchema.min(1),
    })
    .strict()
    .parse(await c.req.json());
  await setSettings({
    ai_base_url: normalizeAiBaseUrl(body.baseUrl),
    ai_api_key: body.apiKey,
    ai_model: body.model,
  });
  return c.json({ ok: true, ai: await getAiSettingsPublic() });
});

setupRoutes.post("/minio", requireAuth, async (c) => {
  const body = z
    .object({
      endpoint: minioEndpointSchema,
      bucket: settingValueSchema.min(1),
      accessKey: settingValueSchema.min(1),
      secretKey: settingValueSchema.min(1),
      region: settingValueSchema.optional(),
      thumbsPrefix: settingValueSchema.optional(),
      vaultPrefix: settingValueSchema.optional(),
    })
    .strict()
    .parse(await c.req.json());
  await setSettings({
    minio_endpoint: normalizeMinioEndpoint(body.endpoint),
    minio_bucket: body.bucket,
    minio_access_key: body.accessKey,
    minio_secret_key: body.secretKey,
    minio_region: body.region,
    minio_thumbs_prefix: body.thumbsPrefix,
    minio_vault_prefix: body.vaultPrefix,
  });
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
