import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { eq, and, gt } from "drizzle-orm";
import { db } from "../db/index.js";
import { sessions } from "../db/schema.js";
import { hashToken } from "../lib/crypto.js";
import { getSetting } from "../lib/settings.js";

export type AuthEnv = {
  Variables: {
    sessionId: string;
  };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const token = getCookie(c, "shannian_session");
  if (!token) {
    return c.json({ error: "UNAUTHORIZED" }, 401);
  }
  const tokenHash = hashToken(token);
  const session = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, Date.now())))
    .get();
  if (!session) {
    return c.json({ error: "UNAUTHORIZED" }, 401);
  }
  c.set("sessionId", session.id);
  await next();
});

export const requireInitialized = createMiddleware(async (c, next) => {
  const hash = await getSetting("password_hash");
  if (!hash) {
    return c.json({ error: "NOT_INITIALIZED" }, 403);
  }
  await next();
});

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function checkLoginRate(ip: string): boolean {
  const now = Date.now();
  const row = loginAttempts.get(ip);
  if (!row || row.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (row.count >= 20) return false;
  row.count += 1;
  return true;
}
