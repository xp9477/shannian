import type { FlashCard } from "@shannian/shared";

/**
 * List primary line: 精炼短摘要 only (no secondary snippet).
 * - Prefer short AI title
 * - If only summary (or title looks like a long body dump), use summary
 */
export function cardHeadline(card: Pick<FlashCard, "title" | "summary" | "note" | "url">): string {
  const t = card.title?.trim() || "";
  const s = card.summary?.trim() || "";

  if (t && s) {
    // Long body-dump "titles" lose to real summary
    if (t.length > 36) return s;
    return t;
  }
  if (t) return t;
  if (s) return s;
  if (card.note?.trim()) return card.note.trim().slice(0, 80);
  if (card.url) return card.url;
  return "无标题";
}

export function formatCardTime(date?: string | number | null): string {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "刚刚";
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24) return `${diffHour}小时前`;
  if (diffDay === 1) {
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `昨天 ${hours}:${minutes}`;
  }
  if (diffDay < 7) return `${diffDay}天前`;
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}-${day}`;
}
