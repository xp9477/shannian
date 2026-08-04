export type Platform =
  | "xiaohongshu"
  | "douyin"
  | "bilibili"
  | "youtube"
  | "x"
  | "telegram"
  | "web"
  | "unknown";

export type CardStatus = "inbox" | "organized" | "deposited";
export type FetchStatus = "pending" | "ok" | "partial" | "failed" | "skipped";
export type AiStatus = "pending" | "ok" | "failed" | "skipped";
/** What the AI summary was grounded on */
export type SummaryBasis = "content" | "description" | "metadata" | "none";

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
}

/** How a card was claimed from a platform import (null = manual/paste) */
export type ImportSource = "x_bookmark";

export interface FlashCard {
  id: string;
  url: string | null;
  urlNormalized: string | null;
  platform: Platform | null;
  title: string | null;
  author: string | null;
  thumbnailKey: string | null;
  thumbnailUrl: string | null;
  note: string | null;
  categoryId: string | null;
  categoryName: string | null;
  status: CardStatus;
  fetchStatus: FetchStatus;
  aiStatus: AiStatus;
  summary: string | null;
  /** Page og/meta description from fetch */
  description: string | null;
  /** Truncated article body excerpt (Readability etc.) */
  contentExcerpt: string | null;
  /** Grounding level for the current summary */
  summaryBasis: SummaryBasis | null;
  /** e.g. x_bookmark — enables platform revoke on permanent delete */
  importSource: ImportSource | null;
  /** Platform-side id (tweet id for X) */
  externalId: string | null;
  depositedAt: number | null;
  depositedObjectKey: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export type ImportJobStatus = "running" | "completed" | "failed" | "cancelled";

export interface ImportJob {
  id: string;
  platform: string;
  status: ImportJobStatus;
  forceFull: boolean;
  scanned: number;
  imported: number;
  claimed: number;
  skipped: number;
  error: string | null;
  message: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PlatformImportPublic {
  id: string;
  label: string;
  importSource: string;
  supportsImport: boolean;
  supportsRevoke: boolean;
  available: boolean;
  comingSoon?: boolean;
  connected: boolean;
  riskNote?: string;
}

export interface XCredentialsPublic {
  hasAuthToken: boolean;
  hasCt0: boolean;
  authTokenHint: string | null;
  ct0Hint: string | null;
}

export interface SetupStatus {
  initialized: boolean;
  hasAi: boolean;
  hasMinio: boolean;
}

export interface AiSettingsPublic {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keyHint: string | null;
}

export interface MinioSettingsPublic {
  endpoint: string;
  bucket: string;
  region: string;
  thumbsPrefix: string;
  vaultPrefix: string;
  hasKeys: boolean;
  accessKeyHint: string | null;
}

/** Outbound HTTP proxy (X / web fetch / AI etc.) */
export interface HttpProxySettingsPublic {
  /** Value stored in settings (empty if using env only) */
  proxyUrl: string;
  /** Resolved proxy actually used, or null for direct */
  effectiveUrl: string | null;
  source: "settings" | "env" | "none";
  hasProxy: boolean;
}

export const DEFAULT_CATEGORIES = [
  "工作",
  "AI工具",
  "旅行",
  "学习",
  "设计/创意",
  "待定",
] as const;

export const PLATFORM_LABELS: Record<Platform, string> = {
  xiaohongshu: "小红书",
  douyin: "抖音",
  bilibili: "哔哩哔哩",
  youtube: "YouTube",
  x: "X",
  telegram: "Telegram",
  web: "网页",
  unknown: "未知",
};
