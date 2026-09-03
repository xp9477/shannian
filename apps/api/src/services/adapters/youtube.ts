import type { PlatformAdapter } from "./types.js";
import { outboundFetch, readResponseJson } from "../../lib/http.js";
import { hostnameMatches } from "../../lib/url.js";

function videoId(url: URL): string | null {
  if (hostnameMatches(url.hostname, "youtu.be")) {
    return url.pathname.slice(1).split("/")[0] || null;
  }
  return url.searchParams.get("v") || url.pathname.match(/\/shorts\/([^/]+)/)?.[1] || null;
}

export const youtubeAdapter: PlatformAdapter = {
  id: "youtube",
  match(url) {
    return hostnameMatches(url.hostname, "youtube.com") || hostnameMatches(url.hostname, "youtu.be");
  },
  async fetchMeta(url) {
    const id = videoId(url);
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url.toString())}&format=json`;
    try {
      const res = await outboundFetch(oembedUrl, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = await readResponseJson<{
          title?: string;
          author_name?: string;
          thumbnail_url?: string;
        }>(res, 512 * 1024);
        const thumb =
          data.thumbnail_url ||
          (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null);
        return {
          platform: "youtube",
          title: data.title,
          author: data.author_name,
          thumbnailUrl: thumb,
          media: thumb
            ? [{ type: "image" as const, url: thumb, posterUrl: null }]
            : null,
          raw: data,
        };
      }
      await res.body?.cancel().catch(() => undefined);
    } catch {
      /* fallthrough */
    }
    const thumb = id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
    return {
      platform: "youtube",
      title: id ? `YouTube ${id}` : "YouTube",
      thumbnailUrl: thumb,
      media: thumb ? [{ type: "image" as const, url: thumb, posterUrl: null }] : null,
    };
  },
};
