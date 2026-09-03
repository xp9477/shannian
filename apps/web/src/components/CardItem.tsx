import type { FlashCard } from "@shannian/shared";
import {
  AlertCircle,
  Archive,
  Check,
  Film,
  Images,
  Inbox,
  Link2,
  Lightbulb,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardHeadline } from "@/lib/card-display";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/theme";

/** Failure chips — state first (失败), not the subsystem name alone */
function FailBadge({ label, title }: { label: string; title: string }) {
  return (
    <Badge
      variant="danger"
      className="inline-flex shrink-0 gap-0.5"
      title={title}
      role="status"
    >
      <AlertCircle className="size-3 shrink-0 opacity-90" aria-hidden />
      <span className="max-sm:sr-only">{label}</span>
    </Badge>
  );
}

function ThumbPlaceholder({ hasUrl }: { hasUrl: boolean }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--color-muted)] to-[var(--color-secondary)] text-[var(--color-muted-foreground)]">
      {hasUrl ? (
        <Link2 className="size-4 opacity-45" aria-hidden />
      ) : (
        <Lightbulb className="size-4 opacity-45" aria-hidden />
      )}
    </div>
  );
}

function FailChips({ card }: { card: FlashCard }) {
  return (
    <>
      {(card.fetchStatus === "partial" || card.fetchStatus === "failed") && (
        <span
          className="inline-flex items-center gap-0.5 rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-800 dark:bg-rose-950 dark:text-rose-200"
          title={
            card.fetchStatus === "partial"
              ? "页面解析不完整，可打开详情重试"
              : "页面解析失败，可打开详情重试"
          }
          role="status"
        >
          <AlertCircle className="size-3 shrink-0" aria-hidden />
          解析失败
        </span>
      )}
      {card.aiStatus === "failed" && (
        <span
          className="inline-flex items-center gap-0.5 rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-800 dark:bg-rose-950 dark:text-rose-200"
          title="AI 摘要生成失败，可打开详情重试"
          role="status"
        >
          <AlertCircle className="size-3 shrink-0" aria-hidden />
          摘要失败
        </span>
      )}
    </>
  );
}

export function CardItem({
  card,
  view,
  selected,
  selectionActive,
  onSelect,
  onClick,
  onDeposit,
  onToInbox,
  onTrash,
}: {
  card: FlashCard;
  view: ViewMode;
  selected?: boolean;
  /** B1: when true, checkboxes stay visible (batch mode) */
  selectionActive?: boolean;
  onSelect?: (id: string, next: boolean) => void;
  onClick: () => void;
  /** 保留 — primary for inbox */
  onDeposit?: (id: string) => void;
  /** 移回收件箱 — weak, hover-only on desktop (P2) */
  onToInbox?: (id: string) => void;
  onTrash?: (id: string) => void;
}) {
  const headline = cardHeadline(card);
  const isInbox = card.status === "inbox";
  const isDeposited = card.status === "organized" || card.status === "deposited";
  const mediaCount = card.media?.length ?? 0;
  const hasVideo = card.media?.some((m) => m.type === "video" || m.type === "gif") ?? false;
  const awaitingSummary =
    !card.summary?.trim() &&
    !card.title?.trim() &&
    (card.aiStatus === "pending" || card.aiStatus === "failed");
  const titleLine =
    card.aiStatus === "pending" && awaitingSummary
      ? "摘要生成中…"
      : card.aiStatus === "failed" && awaitingSummary
        ? "摘要失败 · 可重试"
        : headline;
  const titleMuted = awaitingSummary;

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const showActions = Boolean(onDeposit || onToInbox || onTrash);

  if (view === "grid") {
    return (
      <div
        className={cn(
          "group relative flex h-full flex-col overflow-hidden rounded-[14px] surface-card text-left transition-all duration-200 ease-out",
          "hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--color-primary)_22%,var(--color-border))]",
          selected && "ring-2 ring-[var(--color-primary)]/30 border-[var(--color-primary)]/35",
          isDeposited && "opacity-[0.93]"
        )}
      >
        {onSelect && (
          <label
            className={cn(
              "absolute left-2 top-2 z-10 flex size-10 cursor-pointer items-center justify-center rounded-xl border border-white/70 bg-white/95 shadow-sm backdrop-blur dark:border-[var(--color-border)] dark:bg-[var(--color-card)]/95",
              "focus-within:ring-2 focus-within:ring-[var(--color-ring)]"
            )}
            onClick={stop}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={Boolean(selected)}
              onChange={(e) => onSelect(card.id, e.target.checked)}
              aria-label={`选择：${titleLine}`}
            />
            {selected ? (
              <Check className="size-4 text-[var(--color-primary)]" aria-hidden />
            ) : (
              <span className="size-4 rounded border-2 border-[var(--color-border)]" aria-hidden />
            )}
          </label>
        )}
        <button
          type="button"
          onClick={onClick}
          className="flex min-h-0 flex-1 flex-col text-left focus-visible:outline-none"
        >
          {/* Fixed 4:3 — equal row image heights, editorial crop */}
          <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-[var(--color-muted)]">
            {card.thumbnailUrl ? (
              <img
                src={card.thumbnailUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.03]"
              />
            ) : (
              <div className="absolute inset-0">
                <ThumbPlaceholder hasUrl={Boolean(card.url)} />
              </div>
            )}
            <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
              <FailChips card={card} />
            </div>
            {mediaCount > 1 && (
              <span
                className="absolute bottom-2 right-2 inline-flex items-center gap-0.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                aria-label={`${mediaCount} 个媒体`}
              >
                <Images className="size-3" aria-hidden />
                {mediaCount}
              </span>
            )}
            {mediaCount === 1 && hasVideo && (
              <span
                className="absolute bottom-2 right-2 inline-flex items-center rounded-md bg-black/65 p-1 text-white"
                aria-label="视频"
              >
                <Film className="size-3.5" aria-hidden />
              </span>
            )}
          </div>
          <div className="flex min-h-[3.5rem] items-center px-3.5 py-3">
            <div
              className={cn(
                "reading-title line-clamp-2 w-full text-[14.5px]",
                titleMuted && "font-normal text-[var(--color-muted-foreground)]",
                card.aiStatus === "failed" && awaitingSummary && "text-rose-500/90"
              )}
            >
              {titleLine}
            </div>
          </div>
        </button>
        {showActions && (
          <div
            className={cn(
              "flex gap-1.5 border-t border-[var(--color-border)]/80 px-3 py-2",
              "opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"
            )}
          >
            {isInbox && onDeposit && (
              <Button
                size="sm"
                variant="secondary"
                className="h-8 flex-1 rounded-full text-xs font-medium"
                onClick={(e) => {
                  stop(e);
                  onDeposit(card.id);
                }}
              >
                <Archive className="size-3.5" aria-hidden />
                保留
              </Button>
            )}
            {isDeposited && onToInbox && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 flex-1 rounded-full text-xs font-normal text-[var(--color-muted-foreground)]"
                onClick={(e) => {
                  stop(e);
                  onToInbox(card.id);
                }}
              >
                <Inbox className="size-3.5" aria-hidden />
                移回
              </Button>
            )}
            {onTrash && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 rounded-full text-xs text-[var(--color-destructive)]"
                onClick={(e) => {
                  stop(e);
                  onTrash(card.id);
                }}
                aria-label="移入回收站"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  /* List — one-line headline; comfortable row */
  return (
    <div
      className={cn(
        "group relative flex w-full items-stretch border-b border-[var(--color-border)]/60 transition-colors duration-150 ease-out last:border-b-0",
        "hover:bg-[color-mix(in_oklab,var(--color-muted)_40%,transparent)]",
        selected && "bg-[color-mix(in_oklab,var(--color-primary)_5%,var(--color-card))]",
        isDeposited && "opacity-[0.96]"
      )}
    >
      {onSelect && (
        <label
          className={cn(
            // U3: always visible hit target ≥40px (keyboard + touch); no hover-only hide
            "flex min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center pl-1 sm:pl-2",
            !selectionActive && !selected && "text-[var(--color-muted-foreground)]"
          )}
          onClick={stop}
        >
          <input
            type="checkbox"
            className="size-4 rounded border-[var(--color-border)] accent-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2"
            checked={Boolean(selected)}
            onChange={(e) => onSelect(card.id, e.target.checked)}
            aria-label={`选择：${titleLine}`}
          />
        </label>
      )}
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-3.5 py-3.5 pl-2 pr-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)] sm:pl-3"
      >
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-[10px] bg-[var(--color-muted)] ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
          {card.thumbnailUrl ? (
            <img
              src={card.thumbnailUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          ) : (
            <ThumbPlaceholder hasUrl={Boolean(card.url)} />
          )}
          {mediaCount > 1 && (
            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] font-semibold leading-4 text-white">
              {mediaCount}
            </span>
          )}
          {mediaCount === 1 && hasVideo && (
            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 p-0.5 text-white">
              <Film className="size-2.5" aria-hidden />
            </span>
          )}
        </div>
        <span
          className={cn(
            "reading-title min-w-0 flex-1 line-clamp-1 text-[15px] sm:text-[16px]",
            titleMuted
              ? "font-normal text-[var(--color-muted-foreground)]"
              : "text-[var(--color-foreground)]",
            card.aiStatus === "failed" && awaitingSummary && "text-rose-500/90"
          )}
        >
          {titleLine}
        </span>
        {(card.fetchStatus === "partial" || card.fetchStatus === "failed") && (
          <FailBadge
            label="解析失败"
            title={
              card.fetchStatus === "partial"
                ? "页面解析不完整，可打开详情重试"
                : "页面解析失败，可打开详情重试"
            }
          />
        )}
        {card.aiStatus === "failed" && (
          <FailBadge label="摘要失败" title="AI 摘要生成失败，可打开详情重试" />
        )}
      </button>
      {showActions && (
        <div
          className={cn(
            "flex shrink-0 items-center gap-1 border-l border-[var(--color-border)]/60 px-2 sm:px-3",
            // P2 visual quiet on desktop, but focus-within keeps keyboard path
            "opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100"
          )}
          onClick={stop}
        >
          {isInbox && onDeposit && (
            <Button
              size="sm"
              variant="secondary"
              className="min-h-9 rounded-full px-3 text-xs font-medium"
              onClick={() => onDeposit(card.id)}
            >
              保留
            </Button>
          )}
          {isDeposited && onToInbox && (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-9 rounded-full px-2 text-xs font-normal text-[var(--color-muted-foreground)]"
              onClick={() => onToInbox(card.id)}
              title="移回收件箱"
            >
              <Inbox className="size-3.5 sm:mr-1" aria-hidden />
              <span className="hidden sm:inline">移回</span>
            </Button>
          )}
          {onTrash && (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-9 min-w-9 rounded-full px-2 text-xs text-[var(--color-destructive)]"
              onClick={() => onTrash(card.id)}
              aria-label="移入回收站"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
