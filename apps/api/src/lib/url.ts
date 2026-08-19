import type { Platform } from "@shannian/shared";

const UTM_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "si",
];

export function isProbablyUrl(text: string): boolean {
  const t = text.trim();
  if (/^https?:\/\//i.test(t)) return true;
  if (/^(www\.)?[a-z0-9-]+\.[a-z]{2,}/i.test(t) && !/\s/.test(t)) return true;
  return false;
}

export function ensureUrl(input: string): string {
  const t = input.trim();
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

/** Validate and canonicalize a user-supplied bookmark URL without fetching it. */
export function parseHttpUrl(input: string): string {
  const trimmed = input.trim();
  const explicitScheme = trimmed.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (explicitScheme && explicitScheme !== "http" && explicitScheme !== "https") {
    throw new Error("INVALID_URL");
  }
  let url: URL;
  try {
    url = new URL(ensureUrl(trimmed));
  } catch {
    throw new Error("INVALID_URL");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new Error("INVALID_URL");
  }
  return url.toString();
}

export function normalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(ensureUrl(raw));
  } catch {
    return raw.trim().toLowerCase();
  }
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  for (const p of UTM_PARAMS) u.searchParams.delete(p);
  // sort query for stability
  const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  u.search = "";
  for (const [k, v] of params) u.searchParams.append(k, v);
  let path = u.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  u.pathname = path || "/";
  return u.toString();
}

/** Match a hostname against a registrable domain without accepting lookalike suffixes. */
export function hostnameMatches(hostname: string, domain: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  const expected = domain.trim().toLowerCase().replace(/\.$/, "");
  return host === expected || host.endsWith(`.${expected}`);
}

export function detectPlatform(urlStr: string): Platform {
  try {
    const u = new URL(ensureUrl(urlStr));
    const host = u.hostname;
    if (hostnameMatches(host, "xiaohongshu.com") || hostnameMatches(host, "xhslink.com")) {
      return "xiaohongshu";
    }
    if (hostnameMatches(host, "douyin.com") || hostnameMatches(host, "iesdouyin.com")) {
      return "douyin";
    }
    if (hostnameMatches(host, "bilibili.com") || hostnameMatches(host, "b23.tv")) {
      return "bilibili";
    }
    if (hostnameMatches(host, "youtube.com") || hostnameMatches(host, "youtu.be")) {
      return "youtube";
    }
    if (
      hostnameMatches(host, "x.com") ||
      hostnameMatches(host, "twitter.com") ||
      hostnameMatches(host, "t.co")
    ) {
      return "x";
    }
    if (
      hostnameMatches(host, "t.me") ||
      hostnameMatches(host, "telegram.org") ||
      hostnameMatches(host, "telegram.me")
    ) {
      return "telegram";
    }
    return "web";
  } catch {
    return "unknown";
  }
}

export function extractFirstUrl(text: string): { url: string | null; rest: string } {
  const m = text.match(/https?:\/\/[^\s]+/i);
  if (!m) {
    if (isProbablyUrl(text.trim()) && !text.includes(" ") && !text.includes("\n")) {
      return { url: ensureUrl(text.trim()), rest: "" };
    }
    return { url: null, rest: text };
  }
  const url = m[0].replace(/[),.;]+$/, "");
  const rest = text.replace(m[0], "").trim();
  return { url, rest };
}
