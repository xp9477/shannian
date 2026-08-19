/**
 * Outbound HTTP with optional proxy.
 *
 * Priority for proxy URL:
 * 1. settings key `http_proxy` (if set and non-empty)
 * 2. env HTTPS_PROXY / HTTP_PROXY / https_proxy / http_proxy
 *
 * Empty setting + no env = direct connection.
 */
import { ProxyAgent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { deleteSetting, getSetting, setSetting } from "./settings.js";

const SETTING_KEY = "http_proxy";

let cachedProxyUrl: string | null | undefined;
let cachedAgent: ProxyAgent | null = null;
let cachedAgentKey: string | null = null;

/** Call after proxy setting changes so the next request picks up the new value. */
export function invalidateProxyCache() {
  cachedProxyUrl = undefined;
  if (cachedAgent) {
    try {
      cachedAgent.close();
    } catch {
      /* ignore */
    }
  }
  cachedAgent = null;
  cachedAgentKey = null;
}

function envProxy(): string | null {
  const v =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    "";
  const t = v.trim();
  return t || null;
}

function normalizeProxyUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  // Allow host:port without scheme
  if (/^[\w.-]+:\d+$/.test(t)) {
    return `http://${t}`;
  }
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      // undici ProxyAgent is HTTP CONNECT proxy; socks not supported here
      throw new Error(`不支持的代理协议：${u.protocol}（请用 http:// 或 https://）`);
    }
    if (!u.hostname || u.pathname !== "/" || u.search || u.hash) {
      throw new Error("代理地址只能包含 HTTP(S) host、端口和可选账号密码");
    }
    return u.toString().replace(/\/$/, "");
  } catch (e) {
    if (
      e instanceof Error &&
      (e.message.startsWith("不支持") || e.message.startsWith("代理地址只能"))
    ) {
      throw e;
    }
    // Do not reflect malformed input: it may itself contain proxy credentials.
    throw new Error("代理地址无效");
  }
}

/** Resolve effective proxy URL (settings first, then env). */
export async function getHttpProxyUrl(): Promise<string | null> {
  if (cachedProxyUrl !== undefined) return cachedProxyUrl;
  const fromSettings = await getSetting(SETTING_KEY);
  if (fromSettings !== null && fromSettings.trim() !== "") {
    try {
      cachedProxyUrl = normalizeProxyUrl(fromSettings);
    } catch {
      cachedProxyUrl = null;
    }
    return cachedProxyUrl;
  }
  // Explicit empty string in DB means "no proxy" even if env is set
  if (fromSettings === "") {
    cachedProxyUrl = null;
    return null;
  }
  const fromEnv = envProxy();
  cachedProxyUrl = fromEnv ? normalizeProxyUrl(fromEnv) : null;
  return cachedProxyUrl;
}

/** For settings API: raw stored value + resolved effective URL + source. */
export async function getHttpProxyPublic(): Promise<{
  proxyUrl: string;
  effectiveUrl: string | null;
  source: "settings" | "env" | "none";
  hasProxy: boolean;
  hasCredentials: boolean;
}> {
  invalidateProxyCache();
  const stored = await getSetting(SETTING_KEY);
  if (stored !== null && stored.trim() !== "") {
    let effective: string | null = null;
    try {
      effective = normalizeProxyUrl(stored);
    } catch {
      effective = null;
    }
    const hasCredentials = proxyHasCredentials(effective);
    return {
      proxyUrl: hasCredentials ? "" : effective || "",
      effectiveUrl: effective ? maskProxy(effective) : null,
      source: "settings",
      hasProxy: Boolean(effective),
      hasCredentials,
    };
  }
  if (stored === "") {
    return {
      proxyUrl: "",
      effectiveUrl: null,
      source: "none",
      hasProxy: false,
      hasCredentials: false,
    };
  }
  const fromEnv = envProxy();
  if (fromEnv) {
    let effective: string | null = null;
    try {
      effective = normalizeProxyUrl(fromEnv);
    } catch {
      effective = null;
    }
    const hasCredentials = proxyHasCredentials(effective);
    return {
      proxyUrl: "",
      effectiveUrl: effective ? maskProxy(effective) : null,
      source: "env",
      hasProxy: Boolean(effective),
      hasCredentials,
    };
  }
  return {
    proxyUrl: "",
    effectiveUrl: null,
    source: "none",
    hasProxy: false,
    hasCredentials: false,
  };
}

export async function setHttpProxyUrl(url: string | null): Promise<void> {
  if (url === null || url.trim() === "") {
    // Clear settings entry → fall back to env HTTP(S)_PROXY if present
    await deleteSetting(SETTING_KEY);
  } else {
    const normalized = normalizeProxyUrl(url);
    if (!normalized) {
      await deleteSetting(SETTING_KEY);
    } else {
      await setSetting(SETTING_KEY, normalized);
    }
  }
  invalidateProxyCache();
}

async function getDispatcher(): Promise<ProxyAgent | undefined> {
  const proxyUrl = await getHttpProxyUrl();
  if (!proxyUrl) return undefined;
  if (cachedAgent && cachedAgentKey === proxyUrl) return cachedAgent;
  if (cachedAgent) {
    try {
      cachedAgent.close();
    } catch {
      /* ignore */
    }
  }
  cachedAgent = new ProxyAgent(proxyUrl);
  cachedAgentKey = proxyUrl;
  return cachedAgent;
}

function shouldBypassProxy(target: string | URL): boolean {
  let hostname: string;
  try {
    hostname = (typeof target === "string" ? new URL(target) : target).hostname.toLowerCase();
  } catch {
    return false;
  }
  // Always bypass loopback
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local")
  ) {
    return true;
  }
  const raw = process.env.NO_PROXY || process.env.no_proxy || "";
  if (!raw.trim()) return false;
  const parts = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const p of parts) {
    if (p === "*") return true;
    if (p === hostname) return true;
    if (p.startsWith(".") && hostname.endsWith(p)) return true;
    if (hostname.endsWith("." + p)) return true;
  }
  return false;
}

export type OutboundFetchInit = RequestInit & {
  /** Skip proxy for this request (local MinIO etc.) */
  direct?: boolean;
};

export async function readResponseBuffer(
  response: Response,
  maxBytes: number
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("maxBytes must be a non-negative safe integer");
  }
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader && /^\d+$/.test(lengthHeader)) {
    const declared = Number(lengthHeader);
    if (Number.isSafeInteger(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`RESPONSE_BODY_TOO_LARGE:${maxBytes}`);
    }
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`RESPONSE_BODY_TOO_LARGE:${maxBytes}`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export async function readResponseText(
  response: Response,
  maxBytes: number
): Promise<string> {
  return (await readResponseBuffer(response, maxBytes)).toString("utf8");
}

export async function readResponseJson<T>(
  response: Response,
  maxBytes: number
): Promise<T> {
  return JSON.parse(await readResponseText(response, maxBytes)) as T;
}

/**
 * Drop-in fetch for outbound calls. Uses HTTP proxy when configured.
 * Compatible with standard RequestInit (signal, headers, body, method, redirect).
 * Honors NO_PROXY / no_proxy; always bypasses localhost.
 */
export async function outboundFetch(
  input: string | URL,
  init?: OutboundFetchInit
): Promise<Response> {
  const { direct, ...rest } = init || {};
  const bypass = direct || shouldBypassProxy(input);
  const dispatcher = bypass ? undefined : await getDispatcher();

  if (!dispatcher) {
    return fetch(input, rest);
  }

  // undici fetch + ProxyAgent; cast Response for DOM lib compatibility
  const res = await undiciFetch(String(input), {
    ...(rest as UndiciRequestInit),
    dispatcher,
  });
  return res as unknown as Response;
}

/** Quick connectivity check via proxy (or direct). */
export async function testHttpProxy(probeUrl = "https://api.x.com"): Promise<{
  ok: boolean;
  message: string;
  proxy: string | null;
}> {
  invalidateProxyCache();
  let proxy: string | null = null;
  try {
    proxy = await getHttpProxyUrl();
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
      proxy: null,
    };
  }

  const started = Date.now();
  try {
    const res = await outboundFetch(probeUrl, {
      method: "GET",
      signal: AbortSignal.timeout(12000),
      headers: { Accept: "*/*", "User-Agent": "ShannianProxyTest/0.1" },
    });
    const ms = Date.now() - started;
    await res.body?.cancel().catch(() => undefined);
    // Any HTTP response means TCP/proxy path works (401/403 from X is fine)
    return {
      ok: true,
      message: proxy
        ? `代理可用（经 ${maskProxy(proxy)} → HTTP ${res.status}，${ms}ms）`
        : `直连可用（HTTP ${res.status}，${ms}ms）`,
      proxy: proxy ? maskProxy(proxy) : null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: proxy
        ? `经代理失败（代理 ${maskProxy(proxy)}）`
        : `直连失败：${msg}`,
      proxy: proxy ? maskProxy(proxy) : null,
    };
  }
}

function proxyHasCredentials(url: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return Boolean(parsed.username || parsed.password);
  } catch {
    return false;
  }
}

function maskProxy(url: string): string {
  try {
    const u = new URL(url);
    if (u.username) u.username = "***";
    if (u.password) u.password = "***";
    return u.toString().replace(/\/$/, "");
  } catch {
    return "(invalid)";
  }
}
