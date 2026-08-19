import type { PlatformAdapter } from "./types.js";
import { webAdapter } from "./web.js";
import { getXCredentials, getXQueryIds } from "../import/x-credentials.js";
import {
  fetchTweetById,
  parseTweetIdFromUrl,
  withBackoff,
} from "../import/x-client.js";
import {
  handleFromShellTitle,
  isShellAuthor,
  isShellTitle,
  normalizeXHandle,
  placeholderTitleFromText,
} from "../title.js";
import { hostnameMatches } from "../../lib/url.js";

export const xAdapter: PlatformAdapter = {
  id: "x",
  match(url) {
    return (
      hostnameMatches(url.hostname, "x.com") ||
      hostnameMatches(url.hostname, "twitter.com") ||
      hostnameMatches(url.hostname, "t.co")
    );
  },
  async fetchMeta(url) {
    const tweetId = parseTweetIdFromUrl(url.toString());
    const creds = await getXCredentials();

    if (tweetId && creds) {
      try {
        const qids = await getXQueryIds();
        const item = await withBackoff(
          () =>
            fetchTweetById(creds, tweetId, {
              queryId: qids.tweet || undefined,
            }),
          { retries: 2, baseMs: 1500 }
        );
        const text = item.text?.trim() || null;
        const author = normalizeXHandle(item.authorScreenName);
        const title = placeholderTitleFromText(text);
        const media = item.media || [];
        // Tweet body is content, not page meta — avoid duplicating into description
        return {
          platform: "x",
          title,
          author,
          description: null,
          contentExcerpt: text ? text.slice(0, 6000) : null,
          thumbnailUrl: item.thumbnailUrl ?? media[0]?.posterUrl ?? media[0]?.url ?? null,
          media,
          raw: {
            source: "x_graphql",
            tweetId: item.tweetId,
            authorScreenName: item.authorScreenName,
            authorName: item.authorName,
            hasText: Boolean(text),
            mediaCount: media.length,
          },
        };
      } catch (e) {
        // Fall through to web meta + shell cleaning
        const web = await webFallback(url, {
          graphqlError: e instanceof Error ? e.message : String(e),
        });
        return web;
      }
    }

    return webFallback(url, {
      reason: !tweetId ? "no_tweet_id" : "no_credentials",
    });
  },
};

async function webFallback(
  url: URL,
  rawExtra: Record<string, unknown>
): Promise<Partial<import("./types.js").CardMeta>> {
  const meta = await webAdapter.fetchMeta(url);
  const ogTitle = meta.title || null;
  const description = meta.description?.trim() || null;
  // Prefer real article extract; do not copy meta description into contentExcerpt
  // (that made「页面描述」and「正文摘录」identical in the UI).
  const contentExcerpt = meta.contentExcerpt?.trim() || null;
  const bodyForTitle = contentExcerpt || description;

  // Never keep "Name (@user) on X" as title — use body head or null
  let title: string | null = null;
  if (ogTitle && !isShellTitle(ogTitle)) {
    title = ogTitle;
  } else {
    title = placeholderTitleFromText(bodyForTitle);
  }

  let author: string | null = null;
  if (meta.author && !isShellAuthor(meta.author)) {
    author = meta.author.startsWith("@")
      ? normalizeXHandle(meta.author)
      : meta.author;
  } else {
    author = handleFromShellTitle(ogTitle);
  }

  return {
    platform: "x",
    title,
    author,
    description,
    contentExcerpt,
    thumbnailUrl: meta.thumbnailUrl ?? null,
    raw: {
      source: "web_fallback",
      ...rawExtra,
      web: meta.raw,
      ogTitle,
      cleanedShellTitle: isShellTitle(ogTitle),
    },
  };
}
