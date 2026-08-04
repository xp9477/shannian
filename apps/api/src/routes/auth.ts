import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { sessions } from "../db/schema.js";
import { generateToken, hashPassword, hashToken, verifyPassword } from "../lib/crypto.js";
import { getSetting, setSetting } from "../lib/settings.js";
import { checkLoginRate, requireAuth, type AuthEnv } from "../middleware/auth.js";
import { nanoid } from "nanoid";

export const authRoutes = new Hono<AuthEnv>();

const SESSION_DAYS = 30;

authRoutes.post("/login", async (c) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!checkLoginRate(ip)) {
    return c.json({ error: "RATE_LIMITED" }, 429);
  }
  const body = z.object({ password: z.string().min(1) }).parse(await c.req.json());
  const hash = await getSetting("password_hash");
  if (!hash) return c.json({ error: "NOT_INITIALIZED" }, 403);
  const ok = await verifyPassword(body.password, hash);
  if (!ok) return c.json({ error: "INVALID_PASSWORD" }, 401);

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
    secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
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
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8),
    })
    .parse(await c.req.json());
  const hash = await getSetting("password_hash");
  if (!hash || !(await verifyPassword(body.currentPassword, hash))) {
    return c.json({ error: "INVALID_PASSWORD" }, 401);
  }
  await setSetting("password_hash", await hashPassword(body.newPassword));
  return c.json({ ok: true });
});

authRoutes.get("/me", requireAuth, async (c) => {
  return c.json({ ok: true });
});
