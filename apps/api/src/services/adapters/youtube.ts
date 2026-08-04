import type { PlatformAdapter } from "./types.js";
import { outboundFetch } from "../../lib/http.js";

function videoId(url: URL): string | null {
  if (url.hostname.includes("youtu.be")) {
    return url.pathname.slice(1).split("/")[0] || null;
  }
  return url.searchParams.get("v") || url.pathname.match(/\/shorts\/([^/]+)/)?.[1] || null;
}

export const youtubeAdapter: PlatformAdapter = {
  id: "youtube",
  match(url) {
    const h = url.hostname.replace(/^www\./, "");
    return h === "youtube.com" || h === "m.youtube.com" || h === "youtu.be" || h === "music.youtube.com";
  },
  async fetchMeta(url) {
    const id = videoId(url);
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url.toString())}&format=json`;
    try {
      const res = await outboundFetch(oembedUrl, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = (await res.json()) as {
          title?: string;
          author_name?: string;
          thumbnail_url?: string;
        };
        return {
          platform: "youtube",
          title: data.title,
          author: data.author_name,
          thumbnailUrl:
            data.thumbnail_url ||
            (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null),
          raw: data,
        };
      }
    } catch {
      /* fallthrough */
    }
    return {
      platform: "youtube",
      title: id ? `YouTube ${id}` : "YouTube",
      thumbnailUrl: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null,
    };
  },
};
