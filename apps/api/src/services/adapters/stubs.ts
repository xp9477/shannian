import type { PlatformAdapter } from "./types.js";
import { webAdapter } from "./web.js";
import { hostnameMatches } from "../../lib/url.js";

function stub(id: PlatformAdapter["id"], hosts: (h: string) => boolean): PlatformAdapter {
  return {
    id,
    match(url) {
      return hosts(url.hostname.replace(/^www\./, "").toLowerCase());
    },
    async fetchMeta(url) {
      // Progressive: try generic meta; mark partial often for locked platforms
      const meta = await webAdapter.fetchMeta(url);
      const hasTitle = Boolean(meta.title && meta.title !== url.hostname);
      return {
        ...meta,
        platform: id,
        title: meta.title || null,
        // Keep whatever we got; enrichment layer will set partial/failed
        raw: { ...(typeof meta.raw === "object" && meta.raw ? meta.raw : {}), stub: true, hasTitle },
      };
    },
  };
}

export const xiaohongshuAdapter = stub("xiaohongshu", (h) =>
  hostnameMatches(h, "xiaohongshu.com") || hostnameMatches(h, "xhslink.com")
);
export const douyinAdapter = stub("douyin", (h) =>
  hostnameMatches(h, "douyin.com") || hostnameMatches(h, "iesdouyin.com")
);
export const telegramAdapter = stub("telegram", (h) =>
  hostnameMatches(h, "t.me") ||
  hostnameMatches(h, "telegram.org") ||
  hostnameMatches(h, "telegram.me")
);
