import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { CardStatus, FlashCard } from "@shannian/shared";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Topbar, type TopbarTab } from "@/components/Topbar";
import { CardItem } from "@/components/CardItem";
import { ReadingPane } from "@/components/ReadingPane";
import { CaptureModal } from "@/components/CaptureModal";
import { SettingsModal } from "@/components/SettingsModal";
import { ImportModal } from "@/components/ImportModal";
import { TrashModal } from "@/components/TrashModal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dices, LayoutGrid, List } from "lucide-react";
import { CAPTURE_FOCUS_EVENT } from "@/lib/capture-focus";
import { cardHeadline } from "@/lib/card-display";
import { getViewMode, setViewMode, type ViewMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    tag === "button" ||
    tag === "a" ||
    target.isContentEditable ||
    target.getAttribute("role") === "button" ||
    target.getAttribute("role") === "menuitem" ||
    target.getAttribute("role") === "tab" ||
    target.getAttribute("role") === "dialog" ||
    target.closest("dialog") !== null ||
    target.closest('[role="dialog"]') !== null ||
    target.closest('[role="menu"]') !== null
  ) {
    return true;
  }
  return false;
}

export default function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Cards data
  const [items, setItems] = useState<FlashCard[]>([]);
  const [total, setTotal] = useState(0);

  // Real authoritative counts from backend
  const [inboxCount, setInboxCount] = useState(0);
  const [organizedCount, setOrganizedCount] = useState(0);
  const [thoughtsCount, setThoughtsCount] = useState(0);
  const [trashCount, setTrashCount] = useState(0);

  // Platform pill counts from backend
  const [pillTweetCount, setPillTweetCount] = useState(0);
  const [pillWebCount, setPillWebCount] = useState(0);
  const [pillThoughtCount, setPillThoughtCount] = useState(0);

  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);

  // View Mode: list vs grid (default list, stored in localStorage)
  const [view, setViewState] = useState<ViewMode>(getViewMode());

  // Active tab derived from URL
  const activeTab: TopbarTab = useMemo(() => {
    if (searchParams.get("thoughtsOnly") === "1") return "thoughts";
    if (searchParams.get("status") === "organized" || searchParams.get("status") === "deposited") {
      return "organized";
    }
    return "inbox";
  }, [searchParams]);

  // Filters
  const [qInput, setQInput] = useState(searchParams.get("q") || "");
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [platform, setPlatform] = useState(searchParams.get("platform") || "all");
  const [categoryId, setCategoryId] = useState(searchParams.get("categoryId") || "");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  // Selection & Active Card
  const activeCardId = params.id || null;
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [batchMode, setBatchMode] = useState(false);

  // Quick Capture Hairline
  const [quickText, setQuickText] = useState("");
  const [savingQuick, setSavingQuick] = useState(false);

  // Modals
  const [captureModalOpen, setCaptureModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [trashModalOpen, setTrashModalOpen] = useState(false);

  // Undo Organize & in-flight locks
  const [lastOrganizedCard, setLastOrganizedCard] = useState<FlashCard | null>(null);
  const [organizingPending, setOrganizingPending] = useState(false);
  const organizingInFlightRef = useRef<Set<string>>(new Set());

  // Loading & Pagination refs
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);
  const listRequestIdRef = useRef(0);
  const activeQueryKeyRef = useRef("");
  const mountedRef = useRef(true);
  const itemsLengthRef = useRef(0);
  itemsLengthRef.current = items.length;

  // Scroll Container Ref for scrollTop restoration
  const listScrollRef = useRef<HTMLDivElement>(null);
  const scrollStorageKey = `shannian_scroll_${activeTab}_${categoryId}_${platform}`;

  const captureInputRef = useRef<HTMLInputElement>(null);
  const topbarSearchRef = useRef<HTMLInputElement>(null);

  // Restore scroll position after DOM render
  useLayoutEffect(() => {
    const savedTop = sessionStorage.getItem(scrollStorageKey);
    if (savedTop && listScrollRef.current) {
      listScrollRef.current.scrollTop = Number(savedTop);
    }
  }, [scrollStorageKey, items.length]);

  const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (top > 0) {
      sessionStorage.setItem(scrollStorageKey, String(top));
    }
  };

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 260);
    return () => clearTimeout(t);
  }, [qInput]);

  // Sync search query parameter to URL
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (q) next.set("q", q);
    else next.delete("q");

    if (platform && platform !== "all") next.set("platform", platform);
    else next.delete("platform");

    if (categoryId) next.set("categoryId", categoryId);
    else next.delete("categoryId");

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [q, platform, categoryId]);

  // Handle Tab Switch
  const handleTabChange = (tab: TopbarTab) => {
    const next = new URLSearchParams(searchParams);
    next.delete("q");
    setQInput("");
    setQ("");
    setBatchMode(false);
    setSelectedBatchIds(new Set());

    if (tab === "inbox") {
      next.set("status", "inbox");
      next.delete("thoughtsOnly");
    } else if (tab === "organized") {
      next.set("status", "organized");
      next.delete("thoughtsOnly");
    } else if (tab === "thoughts") {
      next.set("thoughtsOnly", "1");
      next.delete("status");
    }

    const nextUrl = next.toString() ? `/?${next.toString()}` : "/";
    navigate(nextUrl);
  };

  // Authoritative real count loader
  const loadCounts = useCallback(async () => {
    try {
      const [inboxRes, orgRes, thoughtRes, trashRes, tweetRes, webRes, thoughtPillRes, catsRes] =
        await Promise.all([
          api.inboxCount(),
          api.listCards({ status: "organized", limit: "1" }),
          api.listCards({ thoughtsOnly: "1", limit: "1" }),
          api.listCards({ trash: "1", limit: "1" }),
          api.listCards({
            status: activeTab === "inbox" ? "inbox" : activeTab === "organized" ? "organized" : undefined,
            platform: "x",
            limit: "1",
          }),
          api.listCards({
            status: activeTab === "inbox" ? "inbox" : activeTab === "organized" ? "organized" : undefined,
            platform: "web",
            limit: "1",
          }),
          api.listCards({
            status: activeTab === "inbox" ? "inbox" : activeTab === "organized" ? "organized" : undefined,
            thoughtsOnly: "1",
            limit: "1",
          }),
          api.categories(),
        ]);

      if (!mountedRef.current) return;
      setInboxCount(inboxRes.count);
      setOrganizedCount(orgRes.total);
      setThoughtsCount(thoughtRes.total);
      setTrashCount(trashRes.total);
      setPillTweetCount(tweetRes.total);
      setPillWebCount(webRes.total);
      setPillThoughtCount(thoughtPillRes.total);
      setCategories(catsRes.items);
    } catch {
      // Ignore count fetch errors
    }
  }, [activeTab]);

  // List Query Object
  const listQuery = useMemo(() => {
    const query: Record<string, string | undefined> = {
      q: q || undefined,
      limit: String(PAGE_SIZE),
    };

    if (!q) {
      if (activeTab === "inbox") query.status = "inbox";
      else if (activeTab === "organized") query.status = "organized";
      else if (activeTab === "thoughts") query.thoughtsOnly = "1";
    }

    if (platform && platform !== "all") {
      if (platform === "thoughts") query.thoughtsOnly = "1";
      else query.platform = platform;
    }

    if (categoryId) query.categoryId = categoryId;

    return query;
  }, [q, activeTab, platform, categoryId]);

  const queryKey = useMemo(() => JSON.stringify(listQuery), [listQuery]);

  // Fetch Cards with pagination & deduplication & non-destructive background polling
  const loadCards = useCallback(
    async (opts?: { append?: boolean; background?: boolean }) => {
      const append = Boolean(opts?.append);
      const background = Boolean(opts?.background);

      if (queryKey !== activeQueryKeyRef.current && !append && !background) return false;

      const requestId = ++listRequestIdRef.current;
      const requestQueryKey = queryKey;
      const offset = append ? offsetRef.current : 0;

      if (!background) {
        setLoading(!append);
        setLoadingMore(append);
      }

      try {
        // When polling in background, request currently loaded window so we update all loaded items without resetting offset or length!
        const fetchLimit = background
          ? String(Math.max(PAGE_SIZE, offsetRef.current || itemsLengthRef.current))
          : String(PAGE_SIZE);

        const listRes = await api.listCards({
          ...listQuery,
          limit: fetchLimit,
          offset: background ? "0" : String(offset),
        });

        if (
          !mountedRef.current ||
          requestId !== listRequestIdRef.current ||
          requestQueryKey !== activeQueryKeyRef.current
        ) {
          return false;
        }

        let sorted = [...listRes.items];
        if (sortOrder === "asc") {
          sorted.reverse();
        }

        setTotal(listRes.total);

        if (background) {
          // Background polling: merge updated status/summary in place, preserve length & scroll
          setItems((prev) => {
            const updatedMap = new Map(sorted.map((c) => [c.id, c]));
            return prev.map((c) => updatedMap.get(c.id) || c);
          });
        } else if (append) {
          offsetRef.current = offset + listRes.items.length;
          setItems((prev) => {
            const seen = new Set(prev.map((c) => c.id));
            const merged = [...prev];
            for (const c of sorted) {
              if (!seen.has(c.id)) {
                seen.add(c.id);
                merged.push(c);
              }
            }
            return merged;
          });
        } else {
          offsetRef.current = listRes.items.length;
          const seen = new Set<string>();
          const deduped = sorted.filter((c) => {
            if (seen.has(c.id)) return false;
            seen.add(c.id);
            return true;
          });
          setItems(deduped);
        }

        void loadCounts();
        return true;
      } catch (e) {
        if (mountedRef.current && requestId === listRequestIdRef.current && !background) {
          toast.error(e instanceof Error ? e.message : "加载卡片列表失败");
        }
        return false;
      } finally {
        if (mountedRef.current && requestId === listRequestIdRef.current && !background) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [listQuery, queryKey, sortOrder, loadCounts]
  );

  useEffect(() => {
    activeQueryKeyRef.current = queryKey;
    offsetRef.current = 0;
    loadCards({ append: false });
  }, [loadCards, queryKey]);

  // Pending Work 4s lightweight polling
  const hasPendingWork = items.some(
    (c) => c.aiStatus === "pending" || c.fetchStatus === "pending"
  );
  useEffect(() => {
    if (!hasPendingWork) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      await loadCards({ background: true });
      if (!cancelled && mountedRef.current) timer = setTimeout(poll, 4000);
    };

    timer = setTimeout(poll, 4000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hasPendingWork, loadCards]);

  // Capture focus event
  useEffect(() => {
    const onFocus = () => {
      captureInputRef.current?.focus();
    };
    window.addEventListener(CAPTURE_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(CAPTURE_FOCUS_EVENT, onFocus);
  }, []);

  // Currently active card object
  const activeCard = useMemo(() => {
    if (!activeCardId) return null;
    return items.find((c) => c.id === activeCardId) || null;
  }, [activeCardId, items]);

  // If URL has activeCardId not in current items list, fetch it
  useEffect(() => {
    if (activeCardId && !items.some((c) => c.id === activeCardId)) {
      api
        .getCard(activeCardId)
        .then((res) => {
          if (res.card && mountedRef.current) {
            setItems((prev) => {
              if (prev.some((c) => c.id === res.card.id)) return prev;
              return [res.card, ...prev];
            });
          }
        })
        .catch(() => {});
    }
  }, [activeCardId, items]);

  // Keyboard Shortcuts (J, K, Enter, Delete, C, Esc, ⌘K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. If any modal is open, completely disable background shortcuts!
      if (captureModalOpen || settingsModalOpen || importModalOpen || trashModalOpen) {
        return;
      }

      // 2. Respect defaultPrevented or IME composition
      if (e.defaultPrevented || e.isComposing) return;

      // 3. ⌘K or Ctrl+K -> focus search
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        topbarSearchRef.current?.focus();
        return;
      }

      // 4. Do not hijack interactive elements (input, textarea, select, button, a, role=button)
      if (isInteractiveTarget(e.target)) return;

      // 5. No modifiers for single-key actions
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // 6. J / ArrowDown -> navigate next card
      if (e.key.toLowerCase() === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        if (items.length === 0) return;
        const currentIndex = items.findIndex((c) => c.id === activeCardId);
        const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        const nextCard = items[nextIndex];
        if (nextCard) {
          navigate(`/cards/${nextCard.id}${location.search}`);
        }
        return;
      }

      // 7. K / ArrowUp -> navigate previous card
      if (e.key.toLowerCase() === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        if (items.length === 0) return;
        const currentIndex = items.findIndex((c) => c.id === activeCardId);
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        const prevCard = items[prevIndex];
        if (prevCard) {
          navigate(`/cards/${prevCard.id}${location.search}`);
        }
        return;
      }

      // 8. C -> open capture modal
      if (e.key.toLowerCase() === "c") {
        e.preventDefault();
        setCaptureModalOpen(true);
        return;
      }

      // 9. Esc -> exit batch or grid view
      if (e.key === "Escape") {
        if (batchMode) {
          setBatchMode(false);
          setSelectedBatchIds(new Set());
        }
        return;
      }

      // 10. Enter -> Organize active card
      if (e.key === "Enter" && activeCard) {
        e.preventDefault();
        void handleOrganizeCard(activeCard);
        return;
      }

      // 11. Delete / Backspace -> Trash active card
      if ((e.key === "Delete" || e.key === "Backspace") && activeCard) {
        e.preventDefault();
        void handleTrashCard(activeCard);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeCard,
    activeCardId,
    items,
    batchMode,
    captureModalOpen,
    settingsModalOpen,
    importModalOpen,
    trashModalOpen,
    location.search,
    navigate,
  ]);

  // Card Selection
  const handleSelectCard = (card: FlashCard) => {
    navigate(`/cards/${card.id}${location.search}`);
  };

  // Organize Card: removes from inbox, synchronizes server count, advances to next
  const handleOrganizeCard = async (card: FlashCard) => {
    if (organizingInFlightRef.current.has(card.id)) return;
    organizingInFlightRef.current.add(card.id);
    setOrganizingPending(true);

    try {
      const previousStatus = card.status;
      const res = await api.updateCard(card.id, { status: "organized" });
      const updatedCard = res.card;
      (updatedCard as any)._previousStatus = previousStatus;
      setLastOrganizedCard(updatedCard);

      toast.success("已保留");

      // In inbox view (and not in cross-status keyword search), remove from list and advance
      if (!q && activeTab === "inbox") {
        const currentIndex = items.findIndex((c) => c.id === card.id);
        const remaining = items.filter((c) => c.id !== card.id);
        setItems(remaining);

        if (remaining.length > 0) {
          const nextIndex = Math.min(currentIndex, remaining.length - 1);
          const nextCard = remaining[nextIndex];
          navigate(`/cards/${nextCard.id}${location.search}`);
        } else {
          // If no more cards in queue, keep card updated in place
          handleUpdateCard(updatedCard);
        }
      } else {
        handleUpdateCard(updatedCard);
      }
      void loadCounts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保留失败");
    } finally {
      organizingInFlightRef.current.delete(card.id);
      if (mountedRef.current) setOrganizingPending(false);
    }
  };

  // Undo Organize: restore to original status with deduplication
  const handleUndoOrganize = async () => {
    if (!lastOrganizedCard) return;
    const target = lastOrganizedCard;
    setLastOrganizedCard(null);

    try {
      const restoreStatus = (target as any)._previousStatus || "inbox";
      const res = await api.updateCard(target.id, { status: restoreStatus });
      const restoredCard = res.card;

      setItems((prev) => {
        if (prev.some((c) => c.id === restoredCard.id)) {
          return prev.map((c) => (c.id === restoredCard.id ? restoredCard : c));
        }
        return [restoredCard, ...prev];
      });

      void loadCounts();
      navigate(`/cards/${restoredCard.id}${location.search}`);
      toast.success("已撤销保留");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "撤销失败");
    }
  };

  // Trash Card: soft delete and advance
  const handleTrashCard = async (card: FlashCard) => {
    try {
      await api.deleteCard(card.id, false);
      toast.success("已移入回收站");

      const currentIndex = items.findIndex((c) => c.id === card.id);
      const remaining = items.filter((c) => c.id !== card.id);
      setItems(remaining);

      if (remaining.length > 0) {
        const nextCard = remaining[Math.min(currentIndex, remaining.length - 1)];
        navigate(`/cards/${nextCard.id}${location.search}`);
      } else {
        navigate(`/${location.search}`);
      }
      void loadCounts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "移入回收站失败");
    }
  };

  const handleToInbox = async (cardId: string) => {
    try {
      const res = await api.updateCard(cardId, { status: "inbox" });
      setItems((prev) => prev.map((c) => (c.id === cardId ? res.card : c)));
      void loadCounts();
      toast.success("已移回收件箱");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  const handleUpdateCard = (updated: FlashCard) => {
    setItems((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  // Quick Hairline Save
  const saveQuick = async () => {
    if (!quickText.trim() || savingQuick) return;
    setSavingQuick(true);
    try {
      const isHttp = /^https?:\/\//i.test(quickText.trim());
      const res = await api.createCard({
        url: isHttp ? quickText.trim() : undefined,
        text: !isHttp ? quickText.trim() : undefined,
      });

      setQuickText("");
      toast.success(res.existing ? "卡片已存在并更新" : "已录入闪念");
      await loadCards({ append: false });
      if (res.existing) {
        navigate(`/cards/${res.card.id}${location.search}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingQuick(false);
    }
  };

  // Random Review
  const handleDrawOne = async () => {
    try {
      const { card: randomCard } = await api.randomCard();
      if (!randomCard) {
        toast.message("暂无可回顾的卡片");
        return;
      }
      navigate(`/cards/${randomCard.id}${location.search}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "抽取失败");
    }
  };

  // Toggle View Mode
  const handleToggleView = () => {
    const next: ViewMode = view === "list" ? "grid" : "list";
    setViewState(next);
    setViewMode(next);
  };

  // Batch actions
  const handleBatchSelect = (cardId: string, checked: boolean) => {
    setSelectedBatchIds((prev) => {
      const s = new Set(prev);
      if (checked) s.add(cardId);
      else s.delete(cardId);
      return s;
    });
  };

  const handleBatchSelectAll = () => {
    if (selectedBatchIds.size === items.length) {
      setSelectedBatchIds(new Set());
    } else {
      setSelectedBatchIds(new Set(items.map((c) => c.id)));
    }
  };

  const handleBatchAction = async (action: "organize" | "trash" | "retry") => {
    if (selectedBatchIds.size === 0) {
      toast.error("请先选择卡片");
      return;
    }
    const ids = Array.from(selectedBatchIds);
    try {
      const res = await api.bulkCards(ids, action);
      toast.success(`批量操作已完成: 成功 ${res.ok} 项${res.failed > 0 ? `，失败 ${res.failed} 项` : ""}`);
      setSelectedBatchIds(new Set());
      setBatchMode(false);
      await loadCards({ append: false });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "批量操作失败");
    }
  };

  const handleBatchChangeCategory = async (catId: string) => {
    if (selectedBatchIds.size === 0) return;
    const ids = Array.from(selectedBatchIds);
    try {
      await Promise.all(ids.map((id) => api.updateCard(id, { categoryId: catId })));
      toast.success(`已批量移动至新分类`);
      setSelectedBatchIds(new Set());
      await loadCards({ append: false });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "批量移动分类失败");
    }
  };

  const backLabel =
    activeTab === "inbox"
      ? "‹ 返回收件箱"
      : activeTab === "organized"
        ? "‹ 返回已保留"
        : "‹ 返回纯想法";

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#f9fafb] dark:bg-[#0d1117] text-[#111827] dark:text-[#e5e8eb] font-sans">
      <a href="#main-content" className="skip-link">
        跳到主内容
      </a>

      {/* Topbar B (Figma 96:108) */}
      <Topbar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        inboxCount={inboxCount}
        organizedCount={organizedCount}
        thoughtsCount={thoughtsCount}
        trashCount={trashCount}
        searchQuery={qInput}
        onSearchChange={setQInput}
        onOpenCapture={() => setCaptureModalOpen(true)}
        onOpenImport={() => setImportModalOpen(true)}
        onOpenSettings={() => setSettingsModalOpen(true)}
        onOpenTrash={() => setTrashModalOpen(true)}
        searchInputRef={topbarSearchRef}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* Full Workspace Responsive Grid View (When user explicitly toggles Grid) */}
        {view === "grid" && !activeCardId ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#f9fafb] dark:bg-[#0d1117]">
            {/* Grid Header Controls */}
            <div className="h-[44px] shrink-0 border-b border-[#e6e9ec] dark:border-[#23262f] px-6 bg-white dark:bg-[#14161c] flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="font-bold text-[#111827] dark:text-white">网格视图</span>
                <span className="text-[#9ca6b5]">共 {items.length} / {total} 条</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-[#e6e9ec] dark:border-[#30363d]"
                  onClick={handleToggleView}
                >
                  <List className="size-3.5 mr-1" /> 切换为列表视图
                </Button>
              </div>
            </div>

            {/* Grid Container */}
            <div
              ref={listScrollRef}
              onScroll={handleListScroll}
              className="flex-1 overflow-y-auto scroll-thin p-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-max"
            >
              {items.map((card) => {
                const category = categories.find((c) => c.id === card.categoryId);
                return (
                  <CardItem
                    key={card.id}
                    card={card}
                    view="grid"
                    categoryName={category?.name}
                    selected={activeCardId === card.id}
                    selectionActive={batchMode}
                    onSelect={(id, checked) => handleBatchSelect(id, checked)}
                    onClick={() => handleSelectCard(card)}
                    onDeposit={() => handleOrganizeCard(card)}
                    onToInbox={(id) => handleToInbox(id)}
                    onTrash={() => handleTrashCard(card)}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <>
            {/* Left Column (Index Pane, 360px on Desktop) */}
            <aside
              className={cn(
                "w-full lg:w-[360px] lg:shrink-0 lg:border-r border-[#eef0f2] dark:border-[#23262f] bg-white dark:bg-[#14161c] flex flex-col h-full overflow-hidden transition-all duration-150 z-10",
                activeCardId && "hidden lg:flex"
              )}
            >
              {/* Top Filter Bar (Figma 96:107 & 103:604) */}
              <div className="h-[44px] shrink-0 border-b border-[#eff1f3] dark:border-[#23262f] px-3 sm:px-4 flex items-center justify-between text-[12px] bg-white dark:bg-[#14161c] select-none">
                {batchMode ? (
                  <div className="flex items-center justify-between w-full">
                    <button
                      type="button"
                      onClick={handleBatchSelectAll}
                      className="font-bold text-[#1e5bbf] dark:text-[#58a6ff] hover:underline cursor-pointer"
                    >
                      {selectedBatchIds.size === items.length ? "取消全选" : "全选当前"}
                    </button>
                    <span className="text-[#9ca6b5]">已选 {selectedBatchIds.size} 项</span>
                    <button
                      type="button"
                      onClick={() => {
                        setBatchMode(false);
                        setSelectedBatchIds(new Set());
                      }}
                      className="text-[#6b7686] hover:text-[#111827] dark:hover:text-white cursor-pointer"
                    >
                      ✕ 退出批量
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1 overflow-x-auto scroll-thin py-1">
                      <button
                        type="button"
                        onClick={() => setPlatform("all")}
                        className={cn(
                          "px-2 py-1 rounded-[4px] font-medium text-[11px] transition-colors shrink-0 cursor-pointer",
                          platform === "all"
                            ? "bg-[#182233] text-white dark:bg-white dark:text-[#182233]"
                            : "text-[#6b7686] dark:text-[#9ca6b5] hover:bg-[#f2f4f6]"
                        )}
                      >
                        全部 {total}
                      </button>

                      <button
                        type="button"
                        onClick={() => setPlatform("x")}
                        className={cn(
                          "px-2 py-1 rounded-[4px] text-[11px] transition-colors shrink-0 cursor-pointer",
                          platform === "x"
                            ? "bg-[#182233] text-white dark:bg-white dark:text-[#182233]"
                            : "text-[#6b7686] dark:text-[#9ca6b5] hover:bg-[#f2f4f6]"
                        )}
                      >
                        推文 {pillTweetCount}
                      </button>

                      <button
                        type="button"
                        onClick={() => setPlatform("web")}
                        className={cn(
                          "px-2 py-1 rounded-[4px] text-[11px] transition-colors shrink-0 cursor-pointer",
                          platform === "web"
                            ? "bg-[#182233] text-white dark:bg-white dark:text-[#182233]"
                            : "text-[#6b7686] dark:text-[#9ca6b5] hover:bg-[#f2f4f6]"
                        )}
                      >
                        网页 {pillWebCount}
                      </button>

                      <button
                        type="button"
                        onClick={() => setPlatform("thoughts")}
                        className={cn(
                          "px-2 py-1 rounded-[4px] text-[11px] transition-colors shrink-0 cursor-pointer",
                          platform === "thoughts"
                            ? "bg-[#182233] text-white dark:bg-white dark:text-[#182233]"
                            : "text-[#6b7686] dark:text-[#9ca6b5] hover:bg-[#f2f4f6]"
                        )}
                      >
                        想法 {pillThoughtCount}
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Random Review Button */}
                      <button
                        type="button"
                        onClick={handleDrawOne}
                        title="随机回顾 (抽一张)"
                        className="p-1 rounded text-[#6b7686] hover:bg-[#f2f4f6] dark:hover:bg-[#1f242d] transition-colors cursor-pointer"
                      >
                        <Dices className="size-3.5" />
                      </button>

                      {/* List / Grid Toggle */}
                      <button
                        type="button"
                        onClick={handleToggleView}
                        title={view === "list" ? "切换网格视图" : "切换列表视图"}
                        className="p-1 rounded text-[#6b7686] hover:bg-[#f2f4f6] dark:hover:bg-[#1f242d] transition-colors cursor-pointer"
                      >
                        {view === "list" ? <LayoutGrid className="size-3.5" /> : <List className="size-3.5" />}
                      </button>

                      {activeTab === "organized" && (
                        <button
                          type="button"
                          onClick={() => setBatchMode(true)}
                          className="text-[11px] font-medium text-[#1e5bbf] dark:text-[#58a6ff] hover:underline cursor-pointer"
                        >
                          批量管理
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
                        className="text-[11px] text-[#6b7686] dark:text-[#9ca6b5] hover:text-[#111827] dark:hover:text-white cursor-pointer"
                      >
                        {sortOrder === "desc" ? "降序▾" : "升序▴"}
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Quick Capture Hairline Bar */}
              <div className="px-4 py-2 border-b border-[#eef0f2] dark:border-[#23262f] bg-[#f9fafb] dark:bg-[#181c24] flex items-center gap-2">
                <label htmlFor="quick-capture" className="sr-only">
                  快速添加链接或想法
                </label>
                <Input
                  ref={captureInputRef}
                  id="quick-capture"
                  className="h-8 border-0 bg-transparent px-1 text-[13px] shadow-none placeholder:text-[#9ca6b5] focus-visible:ring-0"
                  placeholder="粘贴链接或写下想法… Enter 保存"
                  value={quickText}
                  onChange={(e) => setQuickText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void saveQuick();
                    }
                  }}
                />
                {quickText.trim() && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs font-medium shrink-0"
                    onClick={saveQuick}
                    disabled={savingQuick}
                  >
                    {savingQuick ? "…" : "保存"}
                  </Button>
                )}
              </div>

              {/* Card List Items (Figma 96:107) with scroll retention ref */}
              <div
                ref={listScrollRef}
                onScroll={handleListScroll}
                className="flex-1 overflow-y-auto scroll-thin divide-y divide-[#eff1f3] dark:divide-[#23262f]"
              >
                {items.length === 0 && !loading && (
                  <div className="py-20 text-center text-[13px] text-[#9ca6b5] px-6">
                    {q ? "未检索到匹配的卡片" : "收件箱中暂无卡片，可按 C 或在此处粘贴录入。"}
                  </div>
                )}

                {items.map((card) => {
                  const category = categories.find((c) => c.id === card.categoryId);
                  return (
                    <CardItem
                      key={card.id}
                      card={card}
                      view="list"
                      categoryName={category?.name}
                      selected={activeCardId === card.id}
                      selectionActive={batchMode}
                      onSelect={(id, checked) => handleBatchSelect(id, checked)}
                      onClick={() => handleSelectCard(card)}
                      onDeposit={() => handleOrganizeCard(card)}
                      onToInbox={(id) => handleToInbox(id)}
                      onTrash={() => handleTrashCard(card)}
                    />
                  );
                })}

                {/* Pagination Load More */}
                {items.length < total && (
                  <div className="p-3 text-center border-t border-[#eff1f3] dark:border-[#23262f]">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={loadingMore}
                      onClick={() => loadCards({ append: true })}
                      className="text-[12px] h-8 w-full border-[#e6e9ec] dark:border-[#30363d]"
                    >
                      {loadingMore ? "正在加载…" : `加载更多 (${items.length}/${total})`}
                    </Button>
                  </div>
                )}
              </div>

              {/* Left Footer: Real Authentic Counts */}
              <div className="h-[40px] shrink-0 border-t border-[#eef0f2] dark:border-[#23262f] bg-[#f2f4f6] dark:bg-[#181b22] px-4 flex items-center text-[11px] text-[#546378] dark:text-[#9ca6b5] truncate select-none">
                {activeTab === "inbox"
                  ? `待分流 ${inboxCount} 条 · 回收站 ${trashCount} 条`
                  : activeTab === "organized"
                    ? `共 ${organizedCount} 条已保留归档`
                    : `共 ${thoughtsCount} 条纯想法`}
              </div>
            </aside>

            {/* Right Column: Reading Pane / Detail View */}
            <main
              id="main-content"
              tabIndex={-1}
              className={cn(
                "flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-[#14161c]",
                !activeCardId && "hidden lg:flex"
              )}
            >
              {/* Mobile Back Button Topbar (Figma 101:5) */}
              {activeCardId && (
                <div className="h-[44px] px-4 border-b border-[#eff1f3] dark:border-[#23262f] flex lg:hidden items-center justify-between shrink-0 bg-white dark:bg-[#14161c]">
                  <button
                    type="button"
                    onClick={() => navigate(`/${location.search}`)}
                    className="text-[14px] font-medium text-[#182233] dark:text-white flex items-center gap-1 cursor-pointer"
                  >
                    {backLabel}
                  </button>
                  <span className="bg-[#eef4fe] dark:bg-[#1e293b] text-[#1e5bbf] dark:text-[#60a5fa] px-2 py-0.5 rounded text-[10px] font-medium">
                    {activeCard?.platform === "x" ? "X 推文原件" : activeCard?.url ? "网页原件" : "纯想法"}
                  </span>
                </div>
              )}

              <ReadingPane
                card={activeCard}
                categories={categories}
                inboxCount={inboxCount}
                selectedCount={selectedBatchIds.size}
                selectedCards={items.filter((c) => selectedBatchIds.has(c.id))}
                batchMode={batchMode}
                onExitBatch={() => {
                  setBatchMode(false);
                  setSelectedBatchIds(new Set());
                }}
                onRemoveFromBatch={(id) => handleBatchSelect(id, false)}
                onBatchAction={handleBatchAction}
                onBatchChangeCategory={handleBatchChangeCategory}
                onOrganize={handleOrganizeCard}
                onTrash={handleTrashCard}
                onUpdateCard={handleUpdateCard}
                lastOrganizedCard={lastOrganizedCard}
                onUndoOrganize={handleUndoOrganize}
                organizingPending={organizingPending}
              />
            </main>
          </>
        )}
      </div>

      {/* Mobile Bottom Dock (Figma 96:659) */}
      <div className="h-[56px] border-t border-[#eff1f3] dark:border-[#23262f] bg-white dark:bg-[#14161c] flex lg:hidden items-center justify-around shrink-0 z-30 select-none">
        <button
          type="button"
          onClick={() => handleTabChange("inbox")}
          className={cn(
            "flex flex-col items-center gap-0.5 text-[11px]",
            activeTab === "inbox"
              ? "font-bold text-[#111827] dark:text-white"
              : "text-[#9ca6b5]"
          )}
        >
          <span className="text-base">📥</span>
          <span>收件箱</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("organized")}
          className={cn(
            "flex flex-col items-center gap-0.5 text-[11px]",
            activeTab === "organized"
              ? "font-bold text-[#111827] dark:text-white"
              : "text-[#9ca6b5]"
          )}
        >
          <span className="text-base">📁</span>
          <span>已保留</span>
        </button>

        <button
          type="button"
          onClick={() => setCaptureModalOpen(true)}
          className="flex flex-col items-center gap-0.5 text-[11px] text-[#9ca6b5]"
        >
          <span className="text-base font-bold text-[#182233] dark:text-white">＋</span>
          <span>录入</span>
        </button>

        <button
          type="button"
          onClick={() => setSettingsModalOpen(true)}
          className="flex flex-col items-center gap-0.5 text-[11px] text-[#9ca6b5]"
        >
          <span className="text-base">⚙️</span>
          <span>设置</span>
        </button>
      </div>

      {/* Modals & Dialogs */}
      <CaptureModal
        open={captureModalOpen}
        onClose={() => setCaptureModalOpen(false)}
        categories={categories}
        onCardCreated={(newCard) => {
          setItems((prev) => [newCard, ...prev]);
          navigate(`/cards/${newCard.id}${location.search}`);
        }}
      />

      <SettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        onCategoriesUpdated={() => loadCounts()}
      />

      <ImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImportDone={() => {
          loadCounts();
          loadCards({ append: false });
        }}
      />

      <TrashModal
        open={trashModalOpen}
        onClose={() => setTrashModalOpen(false)}
        onRestoreCard={() => {
          loadCounts();
          loadCards({ append: false });
        }}
      />
    </div>
  );
}
