import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, sqlite } from "../db/index.js";
import { sessions } from "../db/schema.js";
import { sessionCookieSecure } from "../lib/cookie.js";
import { generateToken, hashPassword, hashToken, verifyPassword } from "../lib/crypto.js";
import { getSetting } from "../lib/settings.js";
import {
  checkLoginRate,
  clearLoginRate,
  clientIp,
  requireAuth,
  type AuthEnv,
} from "../middleware/auth.js";
import { nanoid } from "nanoid";
import { passwordSchema } from "../lib/validation.js";

export const authRoutes = new Hono<AuthEnv>();

const SESSION_DAYS = 30;

authRoutes.post("/login", async (c) => {
  const ip = clientIp(c);
  const rate = checkLoginRate(ip);
  if (!rate.allowed) {
    c.header("Retry-After", String(rate.retryAfterSeconds));
    return c.json({ error: "RATE_LIMITED" }, 429);
  }
  const body = z.object({ password: passwordSchema }).strict().parse(await c.req.json());
  const hash = await getSetting("password_hash");
  if (!hash) return c.json({ error: "NOT_INITIALIZED" }, 403);
  const ok = await verifyPassword(body.password, hash);
  if (!ok) return c.json({ error: "INVALID_PASSWORD" }, 401);
  clearLoginRate(ip);

  const token = generateToken();
  const id = nanoid();
  const now = Date.now();
  await db.insert(sessions).values({
    id,
    tokenHash: hashToken(token),
    expiresAt: now + SESSION_DAYS * 864e5,
    createdAt: now,
  });

  setCookie(c, "shannian_session", token, {
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });

  return c.json({ ok: true });
});

authRoutes.post("/logout", requireAuth, async (c) => {
  const sessionId = c.get("sessionId");
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  deleteCookie(c, "shannian_session", { path: "/" });
  return c.json({ ok: true });
});

authRoutes.post("/change-password", requireAuth, async (c) => {
  const body = z
    .object({
      currentPassword: passwordSchema,
      newPassword: passwordSchema,
    })
    .strict()
    .parse(await c.req.json());
  const hash = await getSetting("password_hash");
  if (!hash || !(await verifyPassword(body.currentPassword, hash))) {
    return c.json({ error: "INVALID_PASSWORD" }, 401);
  }
  const nextHash = await hashPassword(body.newPassword);
  const nextToken = generateToken();
  const nextSessionId = nanoid();
  const timestamp = Date.now();
  const rotateCredentials = sqlite.transaction(() => {
    sqlite
      .prepare("UPDATE settings SET value = ? WHERE key = 'password_hash'")
      .run(nextHash);
    sqlite.prepare("DELETE FROM sessions").run();
    sqlite
      .prepare(
        "INSERT INTO sessions (id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(
        nextSessionId,
        hashToken(nextToken),
        timestamp + SESSION_DAYS * 864e5,
        timestamp
      );
  });
  rotateCredentials();
  setCookie(c, "shannian_session", nextToken, {
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return c.json({ ok: true });
});

authRoutes.get("/me", requireAuth, async (c) => {
  return c.json({ ok: true });
});
