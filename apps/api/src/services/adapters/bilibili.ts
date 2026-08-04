import type { PlatformAdapter } from "./types.js";
import { webAdapter } from "./web.js";

export const bilibiliAdapter: PlatformAdapter = {
  id: "bilibili",
  match(url) {
    const h = url.hostname.replace(/^www\./, "");
    return h.includes("bilibili.com") || h === "b23.tv";
  },
  async fetchMeta(url) {
    // Try oEmbed-like public page meta via web adapter first
    const base = await webAdapter.fetchMeta(url);
    return {
      ...base,
      platform: "bilibili",
      title: base.title || "哔哩哔哩",
    };
  },
};
