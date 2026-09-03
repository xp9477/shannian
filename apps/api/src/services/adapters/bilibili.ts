import type { PlatformAdapter } from "./types.js";
import { webAdapter } from "./web.js";
import { hostnameMatches } from "../../lib/url.js";

export const bilibiliAdapter: PlatformAdapter = {
  id: "bilibili",
  match(url) {
    return hostnameMatches(url.hostname, "bilibili.com") || hostnameMatches(url.hostname, "b23.tv");
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
