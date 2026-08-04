import type { Platform } from "@shannian/shared";
import type { CardMeta, PlatformAdapter } from "./types.js";
import { youtubeAdapter } from "./youtube.js";
import { bilibiliAdapter } from "./bilibili.js";
import { xiaohongshuAdapter, douyinAdapter, telegramAdapter } from "./stubs.js";
import { xAdapter } from "./x.js";
import { webAdapter } from "./web.js";
import { ensureUrl } from "../../lib/url.js";

const adapters: PlatformAdapter[] = [
  youtubeAdapter,
  bilibiliAdapter,
  xiaohongshuAdapter,
  douyinAdapter,
  xAdapter,
  telegramAdapter,
  webAdapter,
];

export async function fetchUrlMeta(urlStr: string): Promise<CardMeta> {
  const url = new URL(ensureUrl(urlStr));
  const adapter = adapters.find((a) => a.match(url)) || webAdapter;
  const partial = await adapter.fetchMeta(url);
  return {
    platform: (partial.platform as Platform) || adapter.id,
    title: partial.title ?? null,
    author: partial.author ?? null,
    thumbnailUrl: partial.thumbnailUrl ?? null,
    description: partial.description ?? null,
    contentExcerpt: partial.contentExcerpt ?? null,
    raw: partial.raw,
  };
}

export type { CardMeta };
