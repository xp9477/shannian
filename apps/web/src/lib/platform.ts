import type { Platform } from "@shannian/shared";

/** Cubox-like source color rail / chip accents */
export const PLATFORM_COLORS: Record<Platform, string> = {
  x: "#1d9bf0",
  youtube: "#ff0033",
  bilibili: "#00a1d6",
  xiaohongshu: "#fe2c55",
  douyin: "#111111",
  telegram: "#2aabee",
  web: "#748ffc",
  unknown: "#94a3b8",
};

export function platformColor(platform: Platform | null | undefined): string {
  if (!platform) return "#a78bfa"; // pure thought — soft violet
  return PLATFORM_COLORS[platform] || PLATFORM_COLORS.unknown;
}

/** One-letter / short mark for source chip */
export function platformMark(platform: Platform | null | undefined): string {
  if (!platform) return "想";
  const map: Record<Platform, string> = {
    x: "𝕏",
    youtube: "▶",
    bilibili: "B",
    xiaohongshu: "红",
    douyin: "抖",
    telegram: "T",
    web: "W",
    unknown: "?",
  };
  return map[platform] || "?";
}
