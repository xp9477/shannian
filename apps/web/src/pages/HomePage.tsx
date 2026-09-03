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
  const listRequestIdRef = useRef(0);
  const activeListRequestsRef = useRef(0);
  const activeQueryKeyRef = useRef("");
  const quickSaveRef = useRef(false);
  const cardActionsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);

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

  const listQuery = useMemo(
    () => ({
      q: q || undefined,
      // A keyword is an intent to retrieve knowledge, not just the current
      // inbox slice. Keep deliberately chosen category/platform filters, but
      // search both inbox and organized cards by default.
      status: q ? undefined : filter.status,
      categoryId: filter.categoryId,
      platform: platform || undefined,
      thoughtsOnly: filter.thoughtsOnly ? "1" : undefined,
      incomplete: incomplete ? "1" : undefined,
      aiFailed: aiFailed ? "1" : undefined,
      limit: String(PAGE_SIZE),
    }),
    [
      q,
      filter.status,
      filter.categoryId,
      filter.thoughtsOnly,
      platform,
      incomplete,
      aiFailed,
    ]
  );
  const queryKey = useMemo(() => JSON.stringify(listQuery), [listQuery]);

  const load = useCallback(
    async (opts?: { append?: boolean; background?: boolean }) => {
      const append = Boolean(opts?.append);
      const background = Boolean(opts?.background);

      // Event handlers may resume after the user has already changed filters.
      if (queryKey !== activeQueryKeyRef.current) return false;

      // Background work never competes with a filter change or explicit load.
      if (background && activeListRequestsRef.current > 0) return false;

      const requestId = ++listRequestIdRef.current;
      const requestQueryKey = queryKey;
      const offset = append ? offsetRef.current : 0;
      activeListRequestsRef.current += 1;
      if (!background) {
        setLoading(!append);
        setLoadingMore(append);
      }

      try {
        const [list, count] = await Promise.all([
          api.listCards({ ...listQuery, offset: String(offset) }),
          api.inboxCount(),
        ]);

        if (
          !mountedRef.current ||
          requestId !== listRequestIdRef.current ||
          requestQueryKey !== activeQueryKeyRef.current
        ) {
          return false;
        }

        setTotal(list.total);
        setInbox(count.count);
        if (append) {
          // Advance by server rows consumed, not by React's eventual merged
          // state. State updaters may be replayed in development Strict Mode.
          offsetRef.current = offset + list.items.length;
          setItems((prev) => {
            const seen = new Set(prev.map((x) => x.id));
            const merged = [...prev];
            for (const c of list.items) {
              if (!seen.has(c.id)) merged.push(c);
            }
            return merged;
          });
        } else {
          setItems(list.items);
          offsetRef.current = list.items.length;
          if (!background) setSelected(new Set());
        }
        return true;
      } catch (e) {
        if (
          mountedRef.current &&
          requestId === listRequestIdRef.current &&
          requestQueryKey === activeQueryKeyRef.current
        ) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
        return false;
      } finally {
        activeListRequestsRef.current = Math.max(0, activeListRequestsRef.current - 1);
        if (mountedRef.current && requestId === listRequestIdRef.current && !background) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [listQuery, queryKey]
  );

  useEffect(() => {
    activeQueryKeyRef.current = queryKey;
    offsetRef.current = 0;
    load({ append: false }).catch(() => {});
  }, [load, queryKey]);

  // Categories and setup capabilities are static for the lifetime of this page.
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.categories(), api.settings()])
      .then(([cats, settings]) => {
        if (cancelled) return;
        setCategories(cats.items);
        setSetup(settings.setup);
      })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Soft poll only while server work is actually pending. Schedule the next
  // request after the previous one settles so slow responses never overlap.
  const hasPendingWork = items.some(
    (c) => c.aiStatus === "pending" || c.fetchStatus === "pending"
  );
  useEffect(() => {
    if (!hasPendingWork) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      await load({ background: true });
      if (!cancelled) timer = setTimeout(poll, 4000);
    };

    timer = setTimeout(poll, 4000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hasPendingWork, load]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      listRequestIdRef.current += 1;
    };
  }, []);

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
    if (!quickText.trim() || quickSaveRef.current) return;
    quickSaveRef.current = true;
    setSaving(true);
    try {
      const res = await api.createCard({ text: quickText.trim() });
      if (!mountedRef.current) return;
      setQuickText("");
      toast.success(res.existing ? "已存在，已追加想法" : "已收藏");
      if (res.existing) navigate(`/cards/${res.card.id}`);
      else {
        await load({ append: false });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      quickSaveRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  async function drawOne() {
    try {
      const { card } = await api.randomCard();
      if (!card) {
        toast.message("暂无可回顾的卡片");
        return;
      }
      navigate(`/cards/${card.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "抽取失败");
    }
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
    if (cardActionsRef.current.has(id)) return;
    cardActionsRef.current.add(id);
    try {
      await api.updateCard(id, { status: "organized" });
      // Leave a status-scoped list, but keep global keyword search results.
      setItems((prev) =>
        !q && filter.status === "inbox"
          ? prev.filter((c) => c.id !== id)
          : prev.map((c) => (c.id === id ? { ...c, status: "organized" as const } : c))
      );
      setTotal((t) => (!q && filter.status === "inbox" ? Math.max(0, t - 1) : t));
      setInbox((n) => Math.max(0, n - 1));
      setSelected((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      toast.success("已保留");
    } catch (e) {
      toast.error(String(e));
    } finally {
      cardActionsRef.current.delete(id);
    }
  }

  async function toInboxOne(id: string) {
    if (cardActionsRef.current.has(id)) return;
    cardActionsRef.current.add(id);
    try {
      await api.updateCard(id, { status: "inbox" });
      setItems((prev) =>
        !q && filter.status === "organized"
          ? prev.filter((c) => c.id !== id)
          : prev.map((c) => (c.id === id ? { ...c, status: "inbox" as const } : c))
      );
      setTotal((t) => (!q && filter.status === "organized" ? Math.max(0, t - 1) : t));
      setInbox((n) => n + 1);
      setSelected((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      toast.success("已移回收件箱");
    } catch (e) {
      toast.error(String(e));
    } finally {
      cardActionsRef.current.delete(id);
    }
  }

  async function trashOne(id: string) {
    if (cardActionsRef.current.has(id)) return;
    cardActionsRef.current.add(id);
    const wasInbox = items.some((card) => card.id === id && card.status === "inbox");
    try {
      await api.deleteCard(id);
      setItems((prev) => prev.filter((c) => c.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      if (wasInbox) setInbox((n) => Math.max(0, n - 1));
      setSelected((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      toast.success("已移入回收站");
    } catch (e) {
      toast.error(String(e));
    } finally {
      cardActionsRef.current.delete(id);
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
            ? `已保留 ${r.ok} 条`
            : `已移入回收站 ${r.ok} 条`
      );
      await load({ append: false });
    } catch (e) {
      toast.error(String(e));
    } finally {
      if (mountedRef.current) setBulkBusy(false);
    }
  }

  const canLoadMore = items.length < total;
  const selectionActive = selected.size > 0;
  const pageTitle = q
    ? "搜索"
    : filter.thoughtsOnly
      ? "想法"
      : filter.status === "organized"
        ? "已保留"
        : "收件箱";
  const pageCount =
    q || filter.thoughtsOnly || filter.status === "organized" ? total : inbox;

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
                  保留
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
