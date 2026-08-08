import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { FlashCard } from "@shannian/shared";
import { PLATFORM_LABELS } from "@shannian/shared";
import {
  CheckCircle2,
  ChevronDown,
  Dices,
  Inbox,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AppShell, type NavFilter } from "@/components/AppShell";
import { CardItem } from "@/components/CardItem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty } from "@/components/ui/empty";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { CAPTURE_FOCUS_EVENT } from "@/lib/capture-focus";
import { getViewMode, setViewMode, type ViewMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 100;

function filterFromParams(sp: URLSearchParams): NavFilter {
  const thoughtsOnly = sp.get("thoughtsOnly") === "1" || undefined;
  // B1: 想法 clears status. N2: default home = 收件箱
  if (thoughtsOnly) {
    return {
      thoughtsOnly: true,
      categoryId: sp.get("categoryId") || undefined,
    };
  }
  return {
    status: sp.get("status") || "inbox",
    categoryId: sp.get("categoryId") || undefined,
  };
}

function writeFilterParams(
  sp: URLSearchParams,
  filter: NavFilter,
  extras: { q?: string; platform?: string; incomplete?: boolean; aiFailed?: boolean }
) {
  const next = new URLSearchParams();
  if (filter.status) next.set("status", filter.status);
  if (filter.thoughtsOnly) next.set("thoughtsOnly", "1");
  if (filter.categoryId) next.set("categoryId", filter.categoryId);
  if (extras.q) next.set("q", extras.q);
  if (extras.platform) next.set("platform", extras.platform);
  if (extras.incomplete) next.set("incomplete", "1");
  if (extras.aiFailed) next.set("aiFailed", "1");
  return next;
}

export default function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<FlashCard[]>([]);
  const [total, setTotal] = useState(0);
  const [inbox, setInbox] = useState(0);
  const [qInput, setQInput] = useState(searchParams.get("q") || "");
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [filter, setFilter] = useState<NavFilter>(() => filterFromParams(searchParams));
  const [platform, setPlatform] = useState(searchParams.get("platform") || "");
  const [incomplete, setIncomplete] = useState(searchParams.get("incomplete") === "1");
  const [aiFailed, setAiFailed] = useState(searchParams.get("aiFailed") === "1");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [view, setViewState] = useState<ViewMode>(getViewMode());
  const [setup, setSetup] = useState<{ hasAi: boolean; hasMinio: boolean } | null>(null);
  const [quickText, setQuickText] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(
    () =>
      Boolean(searchParams.get("platform") || searchParams.get("incomplete") || searchParams.get("aiFailed"))
  );
  const offsetRef = useRef(0);
  const captureRef = useRef<HTMLInputElement>(null);

  // Debounce search input → q
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 280);
    return () => clearTimeout(t);
  }, [qInput]);

  // Sync URL when filters change
  useEffect(() => {
    const next = writeFilterParams(searchParams, filter, {
      q,
      platform,
      incomplete,
      aiFailed,
    });
    const a = next.toString();
    const b = searchParams.toString();
    if (a !== b) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only push our keys
  }, [filter, q, platform, incomplete, aiFailed]);

  // Browser back/forward
  useEffect(() => {
    setFilter(filterFromParams(searchParams));
    setPlatform(searchParams.get("platform") || "");
    setIncomplete(searchParams.get("incomplete") === "1");
    setAiFailed(searchParams.get("aiFailed") === "1");
    const qq = searchParams.get("q") || "";
    setQInput(qq);
    setQ(qq);
  }, [searchParams]);

  const listParams = useCallback(
    (offset: number) => ({
      q: q || undefined,
      status: filter.status,
      categoryId: filter.categoryId,
      platform: platform || undefined,
      thoughtsOnly: filter.thoughtsOnly ? "1" : undefined,
      incomplete: incomplete ? "1" : undefined,
      aiFailed: aiFailed ? "1" : undefined,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    }),
    [q, filter, platform, incomplete, aiFailed]
  );

  const load = useCallback(
    async (opts?: { append?: boolean }) => {
      const append = Boolean(opts?.append);
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const offset = append ? offsetRef.current : 0;
        const [list, count, cats, settings] = await Promise.all([
          api.listCards(listParams(offset)),
          api.inboxCount(),
          api.categories(),
          api.settings(),
        ]);
        setTotal(list.total);
        setInbox(count.count);
        setCategories(cats.items);
        setSetup(settings.setup);
        if (append) {
          setItems((prev) => {
            const seen = new Set(prev.map((x) => x.id));
            const merged = [...prev];
            for (const c of list.items) {
              if (!seen.has(c.id)) merged.push(c);
            }
            offsetRef.current = merged.length;
            return merged;
          });
        } else {
          setItems(list.items);
          offsetRef.current = list.items.length;
          setSelected(new Set());
        }
      } catch (e) {
        toast.error(String(e));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [listParams]
  );

  useEffect(() => {
    offsetRef.current = 0;
    load({ append: false }).catch(() => {});
  }, [load]);

  // Soft poll while pending AI / missing thumbs in view
  useEffect(() => {
    const busy = items.some(
      (c) =>
        c.aiStatus === "pending" ||
        c.fetchStatus === "pending" ||
        (c.url && !c.thumbnailUrl)
    );
    if (!busy) return;
    const t = setInterval(() => {
      load({ append: false }).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [items, load]);

  // Focus hairline capture (side nav / empty CTA / navigate state)
  useEffect(() => {
    function focusCapture() {
      captureRef.current?.focus();
    }
    window.addEventListener(CAPTURE_FOCUS_EVENT, focusCapture);
    return () => window.removeEventListener(CAPTURE_FOCUS_EVENT, focusCapture);
  }, []);

  useEffect(() => {
    const st = location.state as { focusCapture?: boolean } | null;
    if (st?.focusCapture) {
      captureRef.current?.focus();
      navigate(".", { replace: true, state: {} });
    }
  }, [location.state, navigate]);

  // U3: Escape clears multi-select
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selected.size > 0) {
        e.preventDefault();
        setSelected(new Set());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size]);

  /** Extra slices beyond current workspace view (for empty-state / clear) */
  const hasExtraFilter = Boolean(filter.categoryId || q || platform || incomplete || aiFailed);
  const filterChipCount = [platform, incomplete, aiFailed].filter(Boolean).length;

  const allVisibleSelected = useMemo(
    () => items.length > 0 && items.every((c) => selected.has(c.id)),
    [items, selected]
  );

  function onFilterChange(next: NavFilter) {
    setFilter(next);
  }

  async function saveQuick() {
    if (!quickText.trim()) return;
    setSaving(true);
    try {
      const res = await api.createCard({ text: quickText.trim() });
      setQuickText("");
      toast.success(res.existing ? "已存在，已追加想法" : "已收藏");
      if (res.existing) navigate(`/cards/${res.card.id}`);
      else {
        await load({ append: false });
        setTimeout(() => load({ append: false }).catch(() => {}), 2500);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function drawOne() {
    const { card } = await api.randomCard();
    if (!card) {
      toast.message("暂无可回顾的卡片");
      return;
    }
    navigate(`/cards/${card.id}`);
  }

  function toggleSelect(id: string, next: boolean) {
    setSelected((prev) => {
      const s = new Set(prev);
      if (next) s.add(id);
      else s.delete(id);
      return s;
    });
  }

  function toggleSelectAll() {
    if (allVisibleSelected) setSelected(new Set());
    else setSelected(new Set(items.map((c) => c.id)));
  }

  async function depositOne(id: string) {
    try {
      await api.updateCard(id, { status: "organized" });
      // Leave current list when filtering inbox; keep in 想法 with updated status
      setItems((prev) =>
        filter.status === "inbox"
          ? prev.filter((c) => c.id !== id)
          : prev.map((c) => (c.id === id ? { ...c, status: "organized" as const } : c))
      );
      setTotal((t) => (filter.status === "inbox" ? Math.max(0, t - 1) : t));
      setInbox((n) => Math.max(0, n - 1));
      setSelected((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      toast.success("已沉淀");
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function toInboxOne(id: string) {
    try {
      await api.updateCard(id, { status: "inbox" });
      setItems((prev) =>
        filter.status === "organized"
          ? prev.filter((c) => c.id !== id)
          : prev.map((c) => (c.id === id ? { ...c, status: "inbox" as const } : c))
      );
      setTotal((t) => (filter.status === "organized" ? Math.max(0, t - 1) : t));
      setInbox((n) => n + 1);
      setSelected((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      toast.success("已移回收件箱");
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function trashOne(id: string) {
    try {
      await api.deleteCard(id);
      setItems((prev) => prev.filter((c) => c.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      setInbox((n) => Math.max(0, n - 1));
      setSelected((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      toast.success("已移入回收站");
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function runBulk(action: "organize" | "trash" | "retry") {
    const ids = [...selected];
    if (!ids.length) return;
    if (action === "trash" && !confirm(`将 ${ids.length} 条移入回收站？`)) return;
    setBulkBusy(true);
    try {
      const r = await api.bulkCards(ids, action);
      toast.success(
        action === "retry"
          ? `已排队重试 ${r.ok} 条`
          : action === "organize"
            ? `已沉淀 ${r.ok} 条`
            : `已移入回收站 ${r.ok} 条`
      );
      await load({ append: false });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBulkBusy(false);
    }
  }

  const canLoadMore = items.length < total;
  const selectionActive = selected.size > 0;
  const pageTitle = filter.thoughtsOnly
    ? "想法"
    : filter.status === "organized"
      ? "沉淀"
      : "收件箱";
  const pageCount =
    filter.thoughtsOnly || filter.status === "organized" ? total : inbox;

  return (
    <TooltipProvider>
      <AppShell
        inboxCount={inbox}
        categories={categories}
        filter={filter}
        onFilterChange={onFilterChange}
      >
        {/* W1: full-width list; single scroll on AppShell main */}
        <div className="w-full px-4 py-5 sm:px-6 lg:px-10">
          {setup && !setup.hasAi && (
            <div
              role="status"
              className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200/70 bg-amber-50/80 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
            >
              <span className="font-medium">待配置</span>
              <span>AI（分类与摘要）</span>
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                onClick={() => navigate("/settings")}
              >
                去设置
              </button>
            </div>
          )}

          {/* C1 + U2: page title rhythm */}
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h1 className="page-title text-[var(--color-foreground)]">
              {pageTitle}
              {!loading && (
                <span className="ml-2.5 text-[13px] font-normal tabular-nums tracking-normal text-[var(--color-muted-foreground)]">
                  {pageCount}
                </span>
              )}
            </h1>
            <Tooltip content="随机抽一条回顾">
              <Button
                variant="ghost"
                size="sm"
                className="min-h-9 rounded-full text-xs text-[var(--color-muted-foreground)]"
                onClick={drawOne}
              >
                <Dices className="size-3.5" aria-hidden />
                抽一张
              </Button>
            </Tooltip>
          </div>

          {/* Capture hairline */}
          <div className="capture-bar mb-5 flex items-center gap-2 py-2 transition-[border-color] duration-150">
            <label htmlFor="quick-capture" className="sr-only">
              快速添加链接或想法
            </label>
            <Input
              ref={captureRef}
              id="quick-capture"
              className="h-10 border-0 bg-transparent px-0 text-[15px] shadow-none placeholder:text-[var(--color-muted-foreground)]/80 focus-visible:ring-0"
              placeholder="粘贴链接或写下想法… Enter 保存"
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  saveQuick();
                }
              }}
            />
            {quickText.trim() && (
              <Button
                size="sm"
                variant="ghost"
                className="min-h-9 shrink-0 rounded-lg text-xs font-medium"
                onClick={saveQuick}
                disabled={saving}
              >
                {saving ? "…" : "保存"}
              </Button>
            )}
          </div>

          {/* F1: search · filters · view */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-muted-foreground)]"
                aria-hidden
              />
              <label htmlFor="search" className="sr-only">
                搜索
              </label>
              <Input
                id="search"
                className="h-10 min-h-10 pl-9"
                placeholder="搜索标题、摘要、想法…"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
            </div>
            <Button
              variant={filtersOpen || filterChipCount > 0 ? "secondary" : "outline"}
              size="sm"
              className="min-h-10 rounded-full gap-1.5 text-xs"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
            >
              <SlidersHorizontal className="size-3.5" aria-hidden />
              筛选
              {filterChipCount > 0 && (
                <span className="rounded-full bg-[var(--color-primary)] px-1.5 text-[10px] font-semibold text-[var(--color-primary-foreground)]">
                  {filterChipCount}
                </span>
              )}
              <ChevronDown
                className={cn("size-3.5 opacity-60 transition-transform", filtersOpen && "rotate-180")}
                aria-hidden
              />
            </Button>
            <div
              className="ml-auto flex items-center gap-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] p-0.5 shadow-sm"
              role="group"
              aria-label="视图"
            >
              <Tooltip content="列表视图">
                <Button
                  variant={view === "list" ? "secondary" : "ghost"}
                  size="icon"
                  className="size-10"
                  aria-pressed={view === "list"}
                  aria-label="列表视图"
                  onClick={() => {
                    setViewMode("list");
                    setViewState("list");
                  }}
                >
                  <List className="size-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content="网格视图">
                <Button
                  variant={view === "grid" ? "secondary" : "ghost"}
                  size="icon"
                  className="size-10"
                  aria-pressed={view === "grid"}
                  aria-label="网格视图"
                  onClick={() => {
                    setViewMode("grid");
                    setViewState("grid");
                  }}
                >
                  <LayoutGrid className="size-3.5" />
                </Button>
              </Tooltip>
            </div>
          </div>

          {filtersOpen && (
            <div
              className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-border)]/80 bg-[var(--color-muted)]/40 px-3 py-2.5"
              role="region"
              aria-label="筛选选项"
            >
              <label htmlFor="platform" className="sr-only">
                平台
              </label>
              <select
                id="platform"
                className="h-10 min-h-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-2 text-xs"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
              >
                <option value="">全部平台</option>
                {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <Button
                variant={incomplete ? "default" : "outline"}
                size="sm"
                className="min-h-9 rounded-full text-xs"
                onClick={() => setIncomplete(!incomplete)}
                aria-pressed={incomplete}
              >
                待补全
              </Button>
              <Button
                variant={aiFailed ? "default" : "outline"}
                size="sm"
                className="min-h-9 rounded-full text-xs"
                onClick={() => setAiFailed(!aiFailed)}
                aria-pressed={aiFailed}
              >
                摘要失败
              </Button>
              {filterChipCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-9 rounded-full text-xs text-[var(--color-muted-foreground)]"
                  onClick={() => {
                    setPlatform("");
                    setIncomplete(false);
                    setAiFailed(false);
                  }}
                >
                  清除切片
                </Button>
              )}
            </div>
          )}

          {/* B1: bulk only when selection active */}
          {selectionActive && (
            <div
              className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-primary)]/20 bg-[color-mix(in_oklab,var(--color-primary)_6%,var(--color-card))] px-3 py-2.5 text-xs"
              role="toolbar"
              aria-label="批量操作"
            >
              <label className="inline-flex min-h-9 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-primary)]"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                />
                全选本页
              </label>
              <span className="tabular-nums text-[var(--color-foreground)]" aria-live="polite">
                已选 {selected.size}
              </span>
              <span className="hidden text-[var(--color-muted-foreground)] sm:inline">
                Esc 取消
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  className="min-h-9"
                  disabled={bulkBusy}
                  onClick={() => runBulk("organize")}
                >
                  <CheckCircle2 className="size-3.5" />
                  沉淀
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-9"
                  disabled={bulkBusy}
                  onClick={() => runBulk("retry")}
                >
                  <RefreshCw className="size-3.5" />
                  重试
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-9 text-[var(--color-destructive)]"
                  disabled={bulkBusy}
                  onClick={() => runBulk("trash")}
                >
                  <Trash2 className="size-3.5" />
                  回收站
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-9"
                  onClick={() => setSelected(new Set())}
                >
                  取消
                </Button>
              </div>
            </div>
          )}

          <div className={cn(view === "grid" ? "pb-2" : "feed-panel")}>
            {items.length === 0 && !loading ? (
              <Empty
                icon={<Inbox className="size-5" aria-hidden />}
                title={hasExtraFilter ? "没有符合条件的条目" : "还没有闪念"}
                description={
                  hasExtraFilter
                    ? "试试清空筛选，或换个关键词。"
                    : "在上方粘贴链接或写下想法。"
                }
                action={
                  hasExtraFilter ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => {
                        setQInput("");
                        setQ("");
                        setPlatform("");
                        setIncomplete(false);
                        setAiFailed(false);
                        setFilter({
                          status: filter.thoughtsOnly ? undefined : filter.status || "inbox",
                          thoughtsOnly: filter.thoughtsOnly,
                        });
                      }}
                    >
                      清除筛选
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="rounded-xl"
                      onClick={() => captureRef.current?.focus()}
                    >
                      添加第一条
                    </Button>
                  )
                }
              />
            ) : view === "grid" ? (
              <div className="grid auto-rows-fr grid-cols-1 items-stretch gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {items.map((card) => (
                  <CardItem
                    key={card.id}
                    card={card}
                    view={view}
                    selected={selected.has(card.id)}
                    selectionActive={selectionActive}
                    onSelect={toggleSelect}
                    onClick={() => navigate(`/cards/${card.id}`)}
                    onDeposit={depositOne}
                    onToInbox={toInboxOne}
                    onTrash={trashOne}
                  />
                ))}
              </div>
            ) : (
              <div role="list">
                {items.map((card) => (
                  <div key={card.id} role="listitem">
                    <CardItem
                      card={card}
                      view={view}
                      selected={selected.has(card.id)}
                      selectionActive={selectionActive}
                      onSelect={toggleSelect}
                      onClick={() => navigate(`/cards/${card.id}`)}
                      onDeposit={depositOne}
                      onToInbox={toInboxOne}
                      onTrash={trashOne}
                    />
                  </div>
                ))}
              </div>
            )}

            {canLoadMore && (
              <div className="flex justify-center border-t border-[var(--color-border)]/70 p-3.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  disabled={loadingMore}
                  onClick={() => load({ append: true })}
                >
                  {loadingMore ? "加载中…" : `加载更多（还有 ${total - items.length} 条）`}
                </Button>
              </div>
            )}
          </div>
        </div>
      </AppShell>
    </TooltipProvider>
  );
}
