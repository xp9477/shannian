import type { FlashCard } from "@shannian/shared";
import { AlertCircle, Archive, Check, Inbox, Link2, Lightbulb, Trash2 } from "lucide-react";
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
      className="hidden shrink-0 gap-0.5 sm:inline-flex"
      title={title}
      role="status"
    >
      <AlertCircle className="size-3 shrink-0 opacity-90" aria-hidden />
      {label}
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
  /** 沉淀 — primary for inbox */
  onDeposit?: (id: string) => void;
  /** 移回收件箱 — weak, hover-only on desktop (P2) */
  onToInbox?: (id: string) => void;
  onTrash?: (id: string) => void;
}) {
  const headline = cardHeadline(card);
  const isInbox = card.status === "inbox";
  const isDeposited = card.status === "organized" || card.status === "deposited";
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
          "group relative flex h-full flex-col overflow-hidden rounded-2xl surface-card text-left transition-all duration-200",
          "hover:-translate-y-0.5 hover:shadow-[0_8px_24px_color-mix(in_oklab,#0f1117_8%,transparent)]",
          selected && "ring-2 ring-[var(--color-primary)]/35 border-[var(--color-primary)]/40",
          isDeposited && "opacity-[0.92]"
        )}
      >
        {onSelect && (
          <label
            className={cn(
              "absolute left-2.5 top-3.5 z-10 flex size-6 cursor-pointer items-center justify-center rounded-lg border border-white/60 bg-white/90 shadow-sm backdrop-blur transition-opacity dark:border-[var(--color-border)] dark:bg-[var(--color-card)]/90",
              selectionActive || selected
                ? "opacity-100"
                : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100"
            )}
            onClick={stop}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={Boolean(selected)}
              onChange={(e) => onSelect(card.id, e.target.checked)}
            />
            {selected ? (
              <Check className="size-3.5 text-[var(--color-primary)]" aria-hidden />
            ) : (
              <span className="size-3.5" />
            )}
          </label>
        )}
        <button
          type="button"
          onClick={onClick}
          className="flex min-h-0 flex-1 flex-col text-left focus-visible:outline-none"
        >
          <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden bg-[var(--color-muted)]">
            {card.thumbnailUrl ? (
              <img
                src={card.thumbnailUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              />
            ) : (
              <div className="absolute inset-0">
                <ThumbPlaceholder hasUrl={Boolean(card.url)} />
              </div>
            )}
            {/* L1: no status badge — only fail chips */}
            <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
              <FailChips card={card} />
            </div>
          </div>
          <div className="flex min-h-[3.25rem] items-center px-3.5 py-3">
            <div
              className={cn(
                "reading-title line-clamp-2 w-full text-[14px] leading-snug",
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
                沉淀
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

  /* List — short summary only; L1 no status pill */
  return (
    <div
      className={cn(
        "group relative flex w-full items-stretch border-b border-[var(--color-border)]/70 transition-colors duration-150 last:border-b-0",
        "hover:bg-[color-mix(in_oklab,var(--color-muted)_55%,transparent)]",
        selected && "bg-[color-mix(in_oklab,var(--color-primary)_6%,var(--color-card))]",
        isDeposited && "bg-[color-mix(in_oklab,var(--color-muted)_35%,transparent)]"
      )}
    >
      {onSelect && (
        <label
          className={cn(
            "flex shrink-0 cursor-pointer items-center pl-2.5 transition-opacity",
            selectionActive || selected
              ? "opacity-100"
              : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100"
          )}
          onClick={stop}
        >
          <input
            type="checkbox"
            className="size-3.5 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
            checked={Boolean(selected)}
            onChange={(e) => onSelect(card.id, e.target.checked)}
            aria-label="选择"
          />
        </label>
      )}
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-3 py-3.5 pl-4 pr-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)]"
      >
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-[var(--color-muted)] ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
          {card.thumbnailUrl ? (
            <img src={card.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <ThumbPlaceholder hasUrl={Boolean(card.url)} />
          )}
        </div>
        <span
          className={cn(
            "reading-title min-w-0 flex-1 line-clamp-1 text-[15px]",
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
            // P2: actions reveal on hover (desktop); always available on touch
            "opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100"
          )}
          onClick={stop}
        >
          {isInbox && onDeposit && (
            <Button
              size="sm"
              variant="secondary"
              className="h-8 rounded-full px-3 text-xs font-medium"
              onClick={() => onDeposit(card.id)}
            >
              沉淀
            </Button>
          )}
          {isDeposited && onToInbox && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 rounded-full px-2 text-xs font-normal text-[var(--color-muted-foreground)]"
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
              className="h-8 rounded-full px-2 text-xs text-[var(--color-destructive)]"
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
