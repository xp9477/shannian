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

export function detectPlatform(urlStr: string): Platform {
  try {
    const u = new URL(ensureUrl(urlStr));
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host.includes("xiaohongshu.com") || host === "xhslink.com") return "xiaohongshu";
    if (host.includes("douyin.com") || host.includes("iesdouyin.com")) return "douyin";
    if (host.includes("bilibili.com") || host.includes("b23.tv")) return "bilibili";
    if (host.includes("youtube.com") || host === "youtu.be") return "youtube";
    if (host === "x.com" || host === "twitter.com" || host === "t.co") return "x";
    if (host.includes("t.me") || host.includes("telegram.")) return "telegram";
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
