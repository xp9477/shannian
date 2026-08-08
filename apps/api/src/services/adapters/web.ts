import type { PlatformAdapter } from "./types.js";
import { extractArticleExcerpt } from "../extract-content.js";
import { outboundFetch } from "../../lib/http.js";

function pickMeta(html: string, prop: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeHtml(m[1].trim());
  }
  return null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function pickTitle(html: string): string | null {
  const og = pickMeta(html, "og:title");
  if (og) return og;
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1] ? decodeHtml(m[1].trim()) : null;
}

export const webAdapter: PlatformAdapter = {
  id: "web",
  match() {
    return true;
  },
  async fetchMeta(url) {
    try {
      const res = await outboundFetch(url.toString(), {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; ShannianBot/0.1; +https://github.com/local/shannian)",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        return { platform: "web", title: url.hostname };
      }
      const html = await res.text();
      const description =
        pickMeta(html, "og:description") || pickMeta(html, "description");
      const contentExcerpt = extractArticleExcerpt(html, url.toString());
      const image =
        pickMeta(html, "og:image") || pickMeta(html, "twitter:image");
      return {
        platform: "web",
        title: pickTitle(html) || url.hostname,
        author: pickMeta(html, "author") || pickMeta(html, "og:site_name"),
        thumbnailUrl: image,
        media: image ? [{ type: "image" as const, url: image, posterUrl: null }] : null,
        description,
        contentExcerpt,
        raw: {
          status: res.status,
          hasDescription: Boolean(description),
          excerptLen: contentExcerpt?.length ?? 0,
        },
      };
    } catch (e) {
      return {
        platform: "web",
        title: url.hostname,
        raw: { error: String(e) },
      };
    }
  },
};
