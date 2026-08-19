import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { CardStatus, FlashCard, SummaryBasis } from "@shannian/shared";
import { PLATFORM_LABELS } from "@shannian/shared";
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Film,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { AppShell } from "../components/AppShell";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Separator } from "../components/ui/separator";
import { Sheet, SheetContent } from "../components/ui/sheet";
import { cn } from "../lib/utils";
import { cardHeadline } from "../lib/card-display";
import { platformColor, platformMark } from "../lib/platform";

function statusLabel(status: CardStatus) {
  if (status === "inbox") return "收件箱";
  // organized + legacy deposited are both decisions to keep the item.
  return "已保留";
}

function summaryStatusLabel(card: FlashCard): { text: string; variant: "outline" | "warning" | "success" | "danger" | "indigo" } {
  if (card.aiStatus === "pending") return { text: "生成中", variant: "warning" };
  if (card.aiStatus === "failed") return { text: "生成失败", variant: "danger" };
  if (card.aiStatus === "skipped") return { text: "未配置 AI", variant: "outline" };
  if (!card.summary) return { text: "无摘要", variant: "outline" };
  const basis = card.summaryBasis as SummaryBasis | null;
  if (basis === "content") return { text: "已根据正文", variant: "success" };
  if (basis === "description") return { text: "已根据描述", variant: "indigo" };
  if (basis === "metadata") return { text: "仅元数据", variant: "outline" };
  if (card.contentExcerpt) return { text: "已根据正文", variant: "success" };
  if (card.description) return { text: "已根据描述", variant: "indigo" };
  return { text: "仅元数据", variant: "outline" };
}

function OrganizePanel({
  card,
  categories,
  categoryId,
  onCategoryChange,
  onStatusChange,
  onExport,
  exporting,
}: {
  card: FlashCard;
  categories: { id: string; name: string }[];
  categoryId: string;
  onCategoryChange: (id: string) => void;
  onStatusChange: (s: CardStatus) => void;
  onExport: () => void;
  exporting: boolean;
}) {
  const uiStatus: CardStatus =
    card.status === "deposited" ? "organized" : card.status;

  return (
    <div className="space-y-5 p-5 pt-10 lg:sticky lg:top-0 lg:max-h-[100dvh] lg:overflow-y-auto lg:pt-5">
      <div>
        <div className="text-[14px] font-semibold tracking-tight">整理</div>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-muted-foreground)]">
          有用 → 保留；没用 → 回收站。导出是单独、可重试的动作。
        </p>
      </div>
      <Separator className="opacity-70" />

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-[var(--color-muted-foreground)]">分类</label>
        <select
          className="h-10 w-full rounded-xl border border-[var(--color-input)] bg-[var(--color-card)] px-2.5 text-sm"
          value={categoryId}
          onChange={(e) => onCategoryChange(e.target.value)}
        >
          <option value="">未分类</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-[var(--color-muted-foreground)]">状态</label>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--color-border)] p-1">
          {(["inbox", "organized"] as CardStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onStatusChange(s)}
              className={cn(
                "rounded-lg px-2 py-2 text-xs font-medium transition-colors",
                uiStatus === s
                  ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] shadow-sm"
                  : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
              )}
            >
              {statusLabel(s)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={exporting}
          onClick={onExport}
        >
          <Archive className="size-3.5" />
          {exporting
            ? "正在导出…"
            : card.depositedAt
              ? "重新导出到 Obsidian"
              : "导出到 Obsidian"}
        </Button>
        {card.depositedAt && (
          <p className="text-[11px] text-[var(--color-muted-foreground)]">
            上次导出：{new Date(card.depositedAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}

export default function CardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [card, setCard] = useState<FlashCard | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [note, setNote] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingAuthor, setEditingAuthor] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [inbox, setInbox] = useState(0);
  const moreRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef(id);
  const editingRef = useRef({ title: false, author: false, note: false });
  const cardReadRequestIdRef = useRef(0);
  const writesInFlightRef = useRef(0);
  const writeTailRef = useRef<Promise<void>>(Promise.resolve());
  const cancelAuthorEditRef = useRef(false);
  const mountedRef = useRef(true);

  activeIdRef.current = id;
  editingRef.current = {
    title: editingTitle,
    author: editingAuthor,
    note: editingNote,
  };

  const applyCard = useCallback((next: FlashCard) => {
    setCard(next);
    const editing = editingRef.current;
    if (!editing.title) setTitle(next.title || "");
    if (!editing.author) setAuthor(next.author || "");
    if (!editing.note) setNote(next.note || "");
    setCategoryId(next.categoryId || "");
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cardReadRequestIdRef.current += 1;
    };
  }, []);

  // Page bootstrap: ancillary navigation data is loaded once per card, never by polling.
  useEffect(() => {
    if (!id) {
      navigate("/");
      return;
    }

    let cancelled = false;
    const requestedId = id;
    const requestId = ++cardReadRequestIdRef.current;
    setCard(null);
    setEditingTitle(false);
    setEditingAuthor(false);
    setEditingNote(false);

    Promise.all([api.getCard(requestedId), api.categories(), api.inboxCount()])
      .then(([{ card: next }, cats, count]) => {
        if (
          cancelled ||
          !mountedRef.current ||
          activeIdRef.current !== requestedId ||
          cardReadRequestIdRef.current !== requestId
        ) {
          return;
        }
        applyCard(next);
        setCategories(cats.items);
        setInbox(count.count);
      })
      .catch(() => {
        if (!cancelled && activeIdRef.current === requestedId) navigate("/");
      });

    return () => {
      cancelled = true;
    };
  }, [applyCard, id, navigate]);

  const refreshCard = useCallback(async () => {
    const requestedId = id;
    if (
      !requestedId ||
      activeIdRef.current !== requestedId ||
      writesInFlightRef.current > 0
    ) {
      return false;
    }

    const requestId = ++cardReadRequestIdRef.current;
    const { card: next } = await api.getCard(requestedId);
    if (
      !mountedRef.current ||
      activeIdRef.current !== requestedId ||
      cardReadRequestIdRef.current !== requestId
    ) {
      return false;
    }
    applyCard(next);
    return true;
  }, [applyCard, id]);

  // Poll only the card. Recursive scheduling guarantees at most one poll in flight.
  const hasPendingWork =
    card?.aiStatus === "pending" || card?.fetchStatus === "pending";
  useEffect(() => {
    if (!hasPendingWork) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      await refreshCard().catch(() => false);
      if (!cancelled) timer = setTimeout(poll, 2000);
    };

    timer = setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hasPendingWork, refreshCard]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    if (moreOpen) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [moreOpen]);

  async function saveFields(
    patch: Record<string, unknown>,
    silent = false
  ): Promise<FlashCard | null> {
    if (!id) return null;
    const requestedId = id;
    // Any read that began before this write must not overwrite its result.
    cardReadRequestIdRef.current += 1;
    writesInFlightRef.current += 1;
    try {
      // Serialize mutations from this screen. This prevents a fast second
      // control change (or an input blur plus click) from racing an earlier
      // PATCH and rendering an older server response last.
      const write = writeTailRef.current.then(
        () => api.updateCard(requestedId, patch),
        () => api.updateCard(requestedId, patch)
      );
      writeTailRef.current = write.then(
        () => undefined,
        () => undefined
      );
      const { card: next } = await write;
      if (!mountedRef.current || activeIdRef.current !== requestedId) return null;
      applyCard(next);
      if (!silent) toast.success("已保存");
      return next;
    } catch (e) {
      if (mountedRef.current) {
        toast.error(e instanceof Error ? e.message : "保存失败");
      }
      return null;
    } finally {
      writesInFlightRef.current = Math.max(0, writesInFlightRef.current - 1);
    }
  }

  async function commitTitle() {
    setEditingTitle(false);
    const saved = await saveFields({ title: title || null });
    if (!mountedRef.current) return;
    setTitle(saved ? saved.title || "" : card?.title || "");
  }

  async function commitAuthor(draft: string) {
    setEditingAuthor(false);
    if (draft === (card?.author || "")) return;
    const saved = await saveFields({ author: draft || null }, true);
    if (!mountedRef.current) return;
    setAuthor(saved ? saved.author || "" : card?.author || "");
  }

  async function commitNote() {
    setEditingNote(false);
    const saved = await saveFields({ note: note || null });
    if (!mountedRef.current) return;
    setNote(saved ? saved.note || "" : card?.note || "");
  }

  async function onCategoryChange(nextId: string) {
    const previousId = card?.categoryId || "";
    setCategoryId(nextId);
    const saved = await saveFields({ categoryId: nextId || null }, true);
    if (saved) toast.success("分类已更新");
    else if (mountedRef.current) setCategoryId(previousId);
  }

  async function onStatusChange(status: CardStatus) {
    if (!id || card?.status === status) return;
    const saved = await saveFields({ status }, true);
    if (!saved) return;
    // Another queued action (for example export) may have changed status first;
    // read the authoritative count instead of applying a stale local delta.
    const count = await api.inboxCount().catch(() => null);
    if (count && mountedRef.current) setInbox(count.count);
    toast.success(`已标为${statusLabel(status)}`);
  }

  async function retryEnrichment() {
    if (!id) return;
    const requestedId = id;
    cardReadRequestIdRef.current += 1;
    writesInFlightRef.current += 1;
    try {
      const write = writeTailRef.current.then(
        () => api.retryEnrich(requestedId),
        () => api.retryEnrich(requestedId)
      );
      writeTailRef.current = write.then(
        () => undefined,
        () => undefined
      );
      const { card: next } = await write;
      if (!mountedRef.current || activeIdRef.current !== requestedId) return;
      applyCard(next);
      toast.message("已重新排队解析/AI（将覆盖摘要与分类建议）");
    } catch (e) {
      if (mountedRef.current) {
        toast.error(e instanceof Error ? e.message : "重试失败");
      }
    } finally {
      writesInFlightRef.current = Math.max(0, writesInFlightRef.current - 1);
    }
  }

  async function exportToObsidian() {
    if (!id || exporting) return;
    const requestedId = id;
    cardReadRequestIdRef.current += 1;
    writesInFlightRef.current += 1;
    setExporting(true);
    try {
      const write = writeTailRef.current.then(
        () => api.exportObsidian(requestedId),
        () => api.exportObsidian(requestedId)
      );
      writeTailRef.current = write.then(
        () => undefined,
        () => undefined
      );
      const { card: next } = await write;
      if (!mountedRef.current || activeIdRef.current !== requestedId) return;
      applyCard(next);
      const count = await api.inboxCount().catch(() => null);
      if (count && mountedRef.current) setInbox(count.count);
      toast.success("已导出 Markdown 到 Obsidian 存储");
    } catch (error) {
      if (!mountedRef.current) return;
      const message = error instanceof Error ? error.message : "导出失败";
      toast.error(message);
    } finally {
      writesInFlightRef.current = Math.max(0, writesInFlightRef.current - 1);
      if (mountedRef.current) setExporting(false);
    }
  }

  if (!card) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted-foreground)]">
        加载中…
      </div>
    );
  }

  const sumStatus = summaryStatusLabel(card);
  const platformLabel = card.platform ? PLATFORM_LABELS[card.platform] : "纯想法";
  const evidenceDesc = card.description?.trim() || "";
  const evidenceExcerpt = card.contentExcerpt?.trim() || "";
  // Older X/import cards stored the same text in both fields — show once
  const evidenceSame =
    Boolean(evidenceDesc && evidenceExcerpt) &&
    evidenceDesc.replace(/\s+/g, " ") === evidenceExcerpt.replace(/\s+/g, " ");
  const hasEvidence = Boolean(evidenceDesc || evidenceExcerpt);

  const organizeProps = {
    card,
    categories,
    categoryId,
    onCategoryChange,
    onStatusChange,
    onExport: exportToObsidian,
    exporting,
  };


  const rail = platformColor(card.platform);
  const isInbox = card.status === "inbox";

  return (
    <AppShell
      inboxCount={inbox}
      categories={categories}
      onFilterChange={() => navigate("/")}
    >
      {/* Sticky Cubox-like reader bar */}
      <div className="sticky top-0 z-30 border-b border-[var(--color-border)]/80 bg-[color-mix(in_oklab,var(--color-background)_88%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex h-12 max-w-[1100px] items-center gap-2 px-3 sm:px-5">
          <Button variant="ghost" size="sm" className="rounded-full px-2.5" onClick={() => navigate(-1)}>
            ← 返回
          </Button>
          <div className="hidden min-w-0 items-center gap-2 sm:flex">
            <span
              className="inline-flex size-5 items-center justify-center rounded-md text-[10px] font-bold text-white"
              style={{ backgroundColor: rail }}
              aria-hidden
            >
              {platformMark(card.platform)}
            </span>
            <span className="truncate text-[13px] text-[var(--color-muted-foreground)]">
              {platformLabel}
              {card.author ? ` · ${card.author}` : ""}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {isInbox && (
              <Button
                size="sm"
                variant="secondary"
                className="rounded-full"
                onClick={() => onStatusChange("organized")}
              >
                <CheckCircle2 className="size-3.5" />
                <span className="hidden sm:inline">保留</span>
              </Button>
            )}
            {!isInbox && (
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full text-[var(--color-muted-foreground)]"
                onClick={() => onStatusChange("inbox")}
              >
                <span className="hidden sm:inline">移回收件箱</span>
                <span className="sm:hidden">移回</span>
              </Button>
            )}
            {card.url && (
              <Button variant="default" size="sm" className="rounded-full" asChild>
                <a href={card.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">打开原链</span>
                </a>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="rounded-full lg:hidden"
              onClick={() => setOrganizeOpen(true)}
            >
              整理
            </Button>
            <div className="relative" ref={moreRef}>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                aria-label="更多"
                onClick={() => setMoreOpen((v) => !v)}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
              {moreOpen && (
                <div className="absolute right-0 top-full z-40 mt-1 min-w-[11rem] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] py-1 shadow-lg">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--color-muted)]"
                    onClick={async () => {
                      setMoreOpen(false);
                      await retryEnrichment();
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    重试解析/AI
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-destructive)] hover:bg-[var(--color-muted)]"
                    onClick={async () => {
                      setMoreOpen(false);
                      if (!confirm("移入回收站？")) return;
                      try {
                        await api.deleteCard(id!);
                        if (mountedRef.current) navigate("/");
                      } catch (e) {
                        if (mountedRef.current) {
                          toast.error(e instanceof Error ? e.message : "移入回收站失败");
                        }
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    移入回收站
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="h-0.5 w-full" style={{ backgroundColor: rail }} aria-hidden />
      </div>

      <div className="mx-auto grid w-full max-w-[1100px] gap-0 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 px-4 py-6 sm:px-8 sm:py-8 lg:pr-10">
          <div className="mx-auto max-w-[40rem] space-y-7">
            <div className="flex gap-5">
              <div className="min-w-0 flex-1 space-y-3">
                {editingTitle ? (
                  <div className="space-y-2">
                    <Input
                      autoFocus
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="text-lg font-semibold"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          void commitTitle();
                        }
                        if (e.key === "Escape") {
                          setTitle(card.title || "");
                          setEditingTitle(false);
                        }
                      }}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void commitTitle()}>
                        完成
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setTitle(card.title || ""); setEditingTitle(false); }}>
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="group flex w-full items-start gap-2 text-left" onClick={() => setEditingTitle(true)}>
                    <h1 className="reading-title text-[1.5rem] sm:text-[1.85rem]">
                      {cardHeadline(card)}
                    </h1>
                    <Pencil className="mt-2 h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-40" />
                  </button>
                )}

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-[var(--color-muted-foreground)]">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-[12px] font-medium text-[var(--color-foreground)]/70">
                    <span className="inline-flex size-4 items-center justify-center rounded text-[9px] font-bold text-white" style={{ backgroundColor: rail }}>
                      {platformMark(card.platform)}
                    </span>
                    {platformLabel}
                  </span>
                  <span className="opacity-30">·</span>
                  {editingAuthor ? (
                    <Input
                      autoFocus
                      className="h-7 w-40 text-sm"
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          cancelAuthorEditRef.current = true;
                          setAuthor(card.author || "");
                          setEditingAuthor(false);
                        }
                      }}
                      onBlur={(e) => {
                        const draft = e.currentTarget.value;
                        if (cancelAuthorEditRef.current) {
                          cancelAuthorEditRef.current = false;
                          return;
                        }
                        void commitAuthor(draft);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="hover:text-[var(--color-foreground)] hover:underline"
                      onClick={() => {
                        cancelAuthorEditRef.current = false;
                        setEditingAuthor(true);
                      }}
                    >
                      {author || "添加作者"}
                    </button>
                  )}
                  <span className="opacity-30">·</span>
                  <span>{statusLabel(card.status)}</span>
                </div>

                {card.categoryName && (
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="indigo">{card.categoryName}</Badge>
                  </div>
                )}
              </div>

              {/* Small cover when no multi-media gallery */}
              {(!card.media || card.media.length === 0) && (
                <div className="hidden h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-[var(--color-muted)] ring-1 ring-black/[0.04] sm:block dark:ring-white/[0.06]">
                  {card.thumbnailUrl ? (
                    <img
                      src={card.thumbnailUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[var(--color-muted-foreground)] opacity-50">
                      {card.url ? "↗" : "·"}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* P1: multi image / video gallery */}
            {card.media && card.media.length > 0 && (
              <section
                className="surface-card overflow-hidden rounded-2xl"
                aria-label={`媒体 ${card.media.length} 项`}
              >
                <div
                  className={cn(
                    "grid gap-0.5 bg-[var(--color-border)]",
                    card.media.length === 1 && "grid-cols-1",
                    card.media.length === 2 && "grid-cols-2",
                    card.media.length >= 3 && "grid-cols-2 sm:grid-cols-2"
                  )}
                >
                  {card.media.map((m, i) => (
                    <div
                      key={`${m.url}-${i}`}
                      className={cn(
                        "relative bg-[var(--color-muted)]",
                        card.media.length === 1 && "aspect-[16/10] max-h-[28rem]",
                        card.media.length === 2 && "aspect-square sm:aspect-[4/3]",
                        card.media.length === 3 && i === 0 && "col-span-2 aspect-[16/9]",
                        card.media.length === 3 && i > 0 && "aspect-square",
                        card.media.length >= 4 && "aspect-square",
                        card.media.length > 4 && i >= 4 && "hidden"
                      )}
                    >
                      {m.type === "image" ? (
                        <a href={m.url} target="_blank" rel="noreferrer" className="block h-full w-full">
                          <img
                            src={m.url}
                            alt=""
                            className="h-full w-full object-cover"
                            loading={i === 0 ? "eager" : "lazy"}
                            referrerPolicy="no-referrer"
                          />
                        </a>
                      ) : (
                        <div className="relative h-full w-full">
                          <video
                            className="h-full w-full object-cover"
                            controls
                            playsInline
                            preload="metadata"
                            poster={m.posterUrl || undefined}
                            src={m.url}
                          />
                          {m.type === "gif" && (
                            <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              GIF
                            </span>
                          )}
                        </div>
                      )}
                      {card.media.length > 4 && i === 3 && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-lg font-semibold text-white">
                          +{card.media.length - 4}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {card.media.some((m) => m.type === "video" || m.type === "gif") && (
                  <div className="flex items-center gap-1.5 border-t border-[var(--color-border)]/70 px-3 py-2 text-[11px] text-[var(--color-muted-foreground)]">
                    <Film className="size-3.5" aria-hidden />
                    含视频/动图 · 可直接播放
                  </div>
                )}
              </section>
            )}

            <section className="surface-card rounded-2xl p-6 sm:p-7">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--color-muted-foreground)]">
                  AI 摘要
                </div>
                <Badge variant={sumStatus.variant}>{sumStatus.text}</Badge>
              </div>
              {card.aiStatus === "pending" ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">正在根据页面信息生成…</p>
              ) : card.summary ? (
                <p className="text-[16.5px] leading-[1.75] tracking-[-0.012em] text-[var(--color-foreground)] sm:text-[17px]">
                  {card.summary}
                </p>
              ) : (
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  {card.aiStatus === "failed"
                    ? "生成失败。可在「⋯」中重试。"
                    : card.aiStatus === "skipped"
                      ? "尚未配置 AI。"
                      : "证据不足，未生成摘要。可在下方写下你的判断。"}
                </p>
              )}

              {hasEvidence && (
                <div className="mt-4 border-t border-[var(--color-border)]/80 pt-3">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                    onClick={() => setEvidenceOpen((v) => !v)}
                  >
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", evidenceOpen && "rotate-180")} />
                    依据
                  </button>
                  {evidenceOpen && (
                    <div className="mt-3 space-y-4 text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">
                      {evidenceSame ? (
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-foreground)]/55">
                            正文摘录
                          </div>
                          <p className="max-h-64 overflow-y-auto scroll-thin whitespace-pre-wrap">
                            {evidenceExcerpt || evidenceDesc}
                          </p>
                        </div>
                      ) : (
                        <>
                          {evidenceDesc && (
                            <div>
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-foreground)]/55">
                                页面描述
                              </div>
                              <p className="whitespace-pre-wrap">{evidenceDesc}</p>
                            </div>
                          )}
                          {evidenceExcerpt && (
                            <div>
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-foreground)]/55">
                                正文摘录
                              </div>
                              <p className="max-h-64 overflow-y-auto scroll-thin whitespace-pre-wrap">
                                {evidenceExcerpt}
                              </p>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted-foreground)]">我的想法</div>
                {!editingNote && (
                  <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setEditingNote(true)}>
                    <Pencil className="h-3.5 w-3.5" />
                    编辑
                  </Button>
                )}
              </div>
              {editingNote ? (
                <div className="space-y-2">
                  <Textarea autoFocus rows={8} className="rounded-2xl text-[15px] leading-relaxed" value={note} onChange={(e) => setNote(e.target.value)} placeholder="写下你的想法、判断或摘抄…" />
                  <div className="flex gap-2">
                    <Button size="sm" className="rounded-full" onClick={() => void commitNote()}>完成</Button>
                    <Button size="sm" variant="ghost" className="rounded-full" onClick={() => { setNote(card.note || ""); setEditingNote(false); }}>取消</Button>
                  </div>
                </div>
              ) : (
                <button type="button" className="w-full rounded-2xl border border-transparent px-1 py-2 text-left hover:border-[var(--color-border)] hover:bg-[var(--color-muted)]/35" onClick={() => setEditingNote(true)}>
                  {note ? (
                    <p className="whitespace-pre-wrap text-[15.5px] leading-[1.7]">{note}</p>
                  ) : (
                    <p className="text-sm text-[var(--color-muted-foreground)]">点击写下想法（摘要只读，纠正写在这里）</p>
                  )}
                </button>
              )}
            </section>
          </div>
        </div>

        <aside className="hidden min-h-[calc(100dvh-3.25rem)] border-l border-[var(--color-border)] bg-[var(--color-sidebar)] lg:block">
          <OrganizePanel {...organizeProps} />
        </aside>
      </div>

      <Sheet open={organizeOpen} onOpenChange={setOrganizeOpen}>
        <SheetContent side="bottom" title="整理" className="overflow-y-auto">
          <OrganizePanel {...organizeProps} />
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
