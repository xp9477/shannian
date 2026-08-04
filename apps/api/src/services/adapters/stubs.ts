import type { PlatformAdapter } from "./types.js";
import { webAdapter } from "./web.js";

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
  h.includes("xiaohongshu.com") || h === "xhslink.com"
);
export const douyinAdapter = stub("douyin", (h) =>
  h.includes("douyin.com") || h.includes("iesdouyin.com")
);
export const telegramAdapter = stub("telegram", (h) =>
  h === "t.me" || h.includes("telegram.org") || h.includes("telegram.me")
);
