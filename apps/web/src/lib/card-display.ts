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
    if (t.length > 28) return s;
    return t;
  }
  if (t) return t;
  if (s) return s;
  if (card.note?.trim()) return card.note.trim().slice(0, 80);
  if (card.url) return card.url;
  return "无标题";
}
