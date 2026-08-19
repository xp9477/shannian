import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { eq, and, gt } from "drizzle-orm";
import { getConnInfo } from "@hono/node-server/conninfo";
import { BlockList, isIP } from "node:net";
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

type AttemptWindow = { count: number; resetAt: number };

const loginAttempts = new Map<string, AttemptWindow>();
let globalAttempts: AttemptWindow | null = null;
const WINDOW_MS = 15 * 60 * 1000;
const PER_IP_LIMIT = 20;
const GLOBAL_LIMIT = 200;
const MAX_TRACKED_IPS = 2_000;

function consumeWindow(
  current: AttemptWindow | null | undefined,
  now: number,
  limit: number
): { row: AttemptWindow; allowed: boolean; retryAfterSeconds: number } {
  const row = !current || current.resetAt <= now
    ? { count: 1, resetAt: now + WINDOW_MS }
    : { count: current.count + 1, resetAt: current.resetAt };
  return {
    row,
    allowed: row.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((row.resetAt - now) / 1000)),
  };
}

function pruneAttempts(now: number) {
  for (const [key, row] of loginAttempts) {
    if (row.resetAt <= now) loginAttempts.delete(key);
  }
  while (loginAttempts.size > MAX_TRACKED_IPS) {
    const oldest = loginAttempts.keys().next().value as string | undefined;
    if (!oldest) break;
    loginAttempts.delete(oldest);
  }
}

export function checkLoginRate(ip: string): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  pruneAttempts(now);

  const global = consumeWindow(globalAttempts, now, GLOBAL_LIMIT);
  globalAttempts = global.row;
  const local = consumeWindow(loginAttempts.get(ip), now, PER_IP_LIMIT);
  loginAttempts.delete(ip);
  loginAttempts.set(ip, local.row);

  return {
    allowed: global.allowed && local.allowed,
    retryAfterSeconds: Math.max(global.retryAfterSeconds, local.retryAfterSeconds),
  };
}

export function clearLoginRate(ip: string): void {
  loginAttempts.delete(ip);
}

let proxyListSpec: string | null = null;
let proxyBlockList: BlockList | null = null;

function trustedProxyList(): BlockList | null {
  const spec = process.env.TRUSTED_PROXY_CIDRS?.trim() || "";
  if (!spec) return null;
  if (spec === proxyListSpec) return proxyBlockList;
  const list = new BlockList();
  for (const rawEntry of spec.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const [address, prefixRaw] = entry.split("/", 2);
    const family = address ? isIP(address) : 0;
    if (!address || family === 0) {
      throw new Error(`Invalid TRUSTED_PROXY_CIDRS entry: ${entry}`);
    }
    const type = family === 4 ? "ipv4" : "ipv6";
    if (prefixRaw === undefined) {
      list.addAddress(address, type);
      continue;
    }
    const prefix = Number(prefixRaw);
    const max = family === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) {
      throw new Error(`Invalid TRUSTED_PROXY_CIDRS prefix: ${entry}`);
    }
    list.addSubnet(address, prefix, type);
  }
  proxyListSpec = spec;
  proxyBlockList = list;
  return list;
}

function remoteAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Forwarding headers are honored only from an explicitly allowlisted proxy.
 * Reading the right side of X-Forwarded-For also prevents a client from
 * prepending arbitrary addresses when a trusted proxy appends its peer.
 */
export function clientIp(c: Context): string {
  const remote = remoteAddress(c);
  const normalizedRemote = remote.startsWith("::ffff:") ? remote.slice(7) : remote;
  const family = isIP(normalizedRemote);
  const trusted = trustedProxyList();
  if (
    process.env.TRUST_PROXY === "true" &&
    trusted &&
    family !== 0 &&
    trusted.check(normalizedRemote, family === 4 ? "ipv4" : "ipv6")
  ) {
    const forwarded = (c.req.header("x-forwarded-for") || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => isIP(value) !== 0);
    const configuredHops = Number(process.env.TRUST_PROXY_HOPS || 1);
    const hops = Number.isInteger(configuredHops)
      ? Math.max(1, Math.min(configuredHops, 10))
      : 1;
    const candidate = forwarded[forwarded.length - hops];
    if (candidate) return candidate;
    const real = c.req.header("x-real-ip")?.trim();
    if (real && isIP(real)) return real;
  }
  return normalizedRemote;
}
