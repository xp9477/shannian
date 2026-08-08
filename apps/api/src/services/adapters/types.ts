import type { CardMediaItem, Platform } from "@shannian/shared";

export interface CardMeta {
  platform: Platform;
  title?: string | null;
  author?: string | null;
  thumbnailUrl?: string | null;
  /** All images / videos on the post */
  media?: CardMediaItem[] | null;
  description?: string | null;
  /** Truncated main-content text for AI (not full archive) */
  contentExcerpt?: string | null;
  raw?: unknown;
}

export interface PlatformAdapter {
  id: Platform;
  match(url: URL): boolean;
  fetchMeta(url: URL): Promise<Partial<CardMeta>>;
}
