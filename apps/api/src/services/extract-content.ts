import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

/** Max chars of article body fed to AI / stored as evidence */
export const CONTENT_EXCERPT_MAX = 6000;

/**
 * Extract main article text from HTML using Mozilla Readability.
 * Returns null when the page has no readable article body.
 */
export function extractArticleExcerpt(html: string, url?: string): string | null {
  if (!html || html.length < 80) return null;
  try {
    const dom = new JSDOM(html, { url: url || "https://local.invalid/" });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    const text = article?.textContent?.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
    if (!text || text.length < 40) return null;
    return text.slice(0, CONTENT_EXCERPT_MAX);
  } catch {
    return null;
  }
}
