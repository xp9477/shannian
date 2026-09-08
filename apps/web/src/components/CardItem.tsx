import React from "react";
import type { FlashCard } from "@shannian/shared";
import { AlertCircle, Check, Film, Inbox, Link2, MessageSquare, Sparkles, Trash2 } from "lucide-react";
import { cardHeadline, formatCardTime } from "@/lib/card-display";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/theme";

function FailBadge({ label, title }: { label: string; title: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50"
      title={title}
      role="status"
    >
      <AlertCircle className="size-2.5 shrink-0 opacity-90" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function CardItem({
  card,
  categoryName,
  view = "list",
  selected = false,
  selectionActive = false,
  onSelect,
  onClick,
  onDeposit,
  onToInbox,
  onTrash,
}: {
  card: FlashCard;
  categoryName?: string;
  view?: ViewMode;
  selected?: boolean;
  selectionActive?: boolean;
  onSelect?: (id: string, next: boolean) => void;
  onClick: () => void;
  onDeposit?: (id: string) => void;
  onToInbox?: (id: string) => void;
  onTrash?: (id: string) => void;
}) {
  const headline = cardHeadline(card);
  const isInbox = card.status === "inbox";
  const isDeposited = card.status === "organized" || card.status === "deposited";
  const hasVideo = card.media?.some((m) => m.type === "video" || m.type === "gif") ?? false;

  // Platform and author formatting
  let platformPrefix = "网页";
  let authorDisplay = "";
  if (card.platform === "x") {
    platformPrefix = "X";
    authorDisplay = card.author ? `@${card.author.replace(/^@/, "")}` : "";
  } else if (!card.url) {
    platformPrefix = "纯想法";
    authorDisplay = "随手记";
  } else if (card.url) {
    try {
      const u = new URL(card.url);
      authorDisplay = u.hostname.replace(/^www\./, "");
    } catch {
      authorDisplay = "";
    }
  }

  const metaDisplay = authorDisplay ? `${platformPrefix} · ${authorDisplay}` : platformPrefix;
  const timeDisplay = formatCardTime(card.createdAt);

  const excerpt =
    card.summary && card.summary !== headline
      ? card.summary
      : card.contentExcerpt || card.description || "";

  const hasNote = Boolean(card.note && card.note.trim());
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // Grid View Mode: rich media preview (reused from HEAD design)
  if (view === "grid") {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group relative flex flex-col overflow-hidden rounded-[10px] border border-[#e6e9ec] dark:border-[#23262f] bg-white dark:bg-[#14161c] text-left transition-all duration-150 hover:shadow-md cursor-pointer h-full",
          selected && "ring-2 ring-[#1e5bbf] border-[#1e5bbf]"
        )}
      >
        {/* Selection Checkbox in Batch mode */}
        {selectionActive && (
          <div
            className="absolute top-2 left-2 z-20"
            onClick={stop}
            onKeyDown={(e) => stop(e as unknown as React.MouseEvent)}
          >
            <label className="flex size-4 cursor-pointer items-center justify-center rounded border border-[#d1d5db] bg-white/95 dark:bg-[#1f242d] shadow-sm">
              <input
                type="checkbox"
                className="sr-only"
                checked={Boolean(selected)}
                onChange={(e) => onSelect?.(card.id, e.target.checked)}
                aria-label={`选择：${headline}`}
              />
              {selected && <Check className="size-3 text-[#1e5bbf] stroke-[3]" />}
            </label>
          </div>
        )}

        {/* 4:3 Aspect Ratio Thumbnail Preview */}
        <div className="relative aspect-[4/3] w-full bg-[#f2f4f6] dark:bg-[#1f242d] overflow-hidden shrink-0">
          {card.thumbnailUrl ? (
            <img
              src={card.thumbnailUrl}
              alt=""
              className="size-full object-cover group-hover:scale-105 transition-transform duration-200"
              loading="lazy"
            />
          ) : (
            <div className="size-full flex items-center justify-center text-[#9ca6b5]">
              {card.url ? <Link2 className="size-6 opacity-40" /> : <Sparkles className="size-6 opacity-40" />}
            </div>
          )}
          {hasVideo && (
            <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white flex items-center gap-1">
              <Film className="size-2.5" /> 视频
            </span>
          )}
          {isDeposited && (
            <span className="absolute top-2 right-2 bg-[#06784c] text-white px-1.5 py-0.5 rounded text-[10px] font-medium shadow-xs">
              已保留
            </span>
          )}
        </div>

        <div className="p-3.5 flex flex-col flex-1 justify-between gap-2 min-w-0">
          <div>
            <div className="flex items-center justify-between text-[11px] text-[#546378] dark:text-[#9ca6b5] mb-1">
              <span className="truncate">{metaDisplay}</span>
              <span className="shrink-0">{timeDisplay}</span>
            </div>
            <h3 className="font-medium text-[13px] text-[#111827] dark:text-white line-clamp-2 leading-[18px]">
              {headline}
            </h3>
            {excerpt && excerpt.trim() !== headline.trim() && (
              <p className="mt-1 text-[11px] text-[#546378] dark:text-[#9ca6b5] line-clamp-2 leading-[16px]">
                {excerpt}
              </p>
            )}
          </div>
          {hasNote && (
            <div className="text-[10px] text-[#1e5bbf] flex items-center gap-1 truncate pt-1 border-t border-[#eff1f3] dark:border-[#23262f]">
              <MessageSquare className="size-2.5 shrink-0" />
              <span className="truncate">{card.note}</span>
            </div>
          )}
        </div>
      </button>
    );
  }

  // Default List View Mode: Figma 96:107 360px Index Row
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative w-full border-b border-[#eef0f2] dark:border-[#23262f] text-left transition-colors duration-150 cursor-pointer select-none block",
        "border-l-[3px] box-border pl-[18px] pr-[22px] py-[14px]",
        selected
          ? "border-l-[#1e5bbf] bg-[#f4f7fb] dark:bg-[#1b2230]"
          : "border-l-transparent bg-white dark:bg-[#14161c] hover:bg-[#f8fafc] dark:hover:bg-[#181c24]"
      )}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        {selectionActive && (
          <div
            className="pt-0.5 shrink-0"
            onClick={stop}
            onKeyDown={(e) => stop(e as unknown as React.MouseEvent)}
          >
            <label className="flex size-4 cursor-pointer items-center justify-center rounded border border-[#d1d5db] dark:border-[#4b5563] bg-white dark:bg-[#1f242d] shadow-sm">
              <input
                type="checkbox"
                className="sr-only"
                checked={Boolean(selected)}
                onChange={(e) => onSelect?.(card.id, e.target.checked)}
                aria-label={`选择：${headline}`}
              />
              {selected ? <Check className="size-3 text-[#1e5bbf] stroke-[3]" aria-hidden="true" /> : null}
            </label>
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          {/* MetaRow */}
          <div className="flex items-center justify-between gap-1.5 h-[18px] min-w-0">
            <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
              {categoryName && (
                <span className="shrink-0 bg-[#f2f4f6] dark:bg-[#21262d] px-1.5 py-0.5 rounded-[3px] text-[10px] font-medium text-[#546378] dark:text-[#9ca6b5] leading-none">
                  {categoryName}
                </span>
              )}
              {isDeposited && (
                <span className="shrink-0 bg-[#eefbf3] dark:bg-[#064e3b]/30 px-1.5 py-0.5 rounded-[3px] text-[10px] font-medium text-[#06784c] dark:text-[#34d399] leading-none">
                  已保留
                </span>
              )}
              <span className="truncate text-[11px] text-[#546378] dark:text-[#8896a6] font-sans">
                {metaDisplay}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {card.fetchStatus === "failed" && <FailBadge label="解析失败" title="页面解析失败" />}
              {card.aiStatus === "failed" && <FailBadge label="摘要失败" title="AI 摘要生成失败" />}
              {timeDisplay && (
                <span className="text-[11px] text-[#708094] dark:text-[#6b7686] font-sans whitespace-nowrap">
                  {timeDisplay}
                </span>
              )}
            </div>
          </div>

          {/* Title: max 2 lines, natural ellipsis */}
          <span className="block mt-1 text-[14px] font-medium leading-[20px] text-[#111827] dark:text-[#e5e8eb] line-clamp-2 min-w-0 break-words font-ui">
            {headline}
          </span>

          {/* Excerpt: line-clamp-2, omit if identical to headline */}
          {excerpt && excerpt.trim() !== headline.trim() && (
            <p className="mt-1 text-[12px] text-[#546378] dark:text-[#9ca6b5] leading-[17px] line-clamp-2 min-w-0 break-words font-ui">
              {excerpt}
            </p>
          )}

          {/* Note line: independent row with >= 8px separation, omit if identical to headline */}
          {hasNote && card.note?.trim() !== headline.trim() && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#1e5bbf] dark:text-[#60a5fa] font-medium min-w-0 truncate">
              <MessageSquare className="size-3 shrink-0 text-[#1e5bbf] dark:text-[#60a5fa]" aria-hidden="true" />
              <span className="truncate">已批注想法 · {card.note}</span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
