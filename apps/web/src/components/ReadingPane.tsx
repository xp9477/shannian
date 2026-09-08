import React, { useEffect, useRef, useState } from "react";
import type { FlashCard } from "@shannian/shared";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ExternalLink,
  Film,
  MoreHorizontal,
  Paperclip,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cardHeadline } from "@/lib/card-display";
import { cn } from "@/lib/utils";

interface ReadingPaneProps {
  card: FlashCard | null;
  categories: { id: string; name: string }[];
  inboxCount?: number;
  selectedCount?: number;
  selectedCards?: FlashCard[];
  batchMode?: boolean;
  onExitBatch?: () => void;
  onRemoveFromBatch?: (id: string) => void;
  onBatchAction?: (action: "organize" | "trash" | "retry") => void;
  onBatchChangeCategory?: (categoryId: string) => void;
  onOrganize: (card: FlashCard) => void;
  onTrash: (card: FlashCard) => void;
  onUpdateCard: (updated: FlashCard) => void;
  lastOrganizedCard?: FlashCard | null;
  onUndoOrganize?: () => void;
  organizingPending?: boolean;
}

// Storage helpers for draft recovery across navigation / unmounting
function saveDraftToStorage(id: string, text: string) {
  try {
    sessionStorage.setItem(`shannian_draft_note_${id}`, text);
  } catch {}
}
function clearDraftFromStorage(id: string) {
  try {
    sessionStorage.removeItem(`shannian_draft_note_${id}`);
  } catch {}
}
function getDraftFromStorage(id: string): string | null {
  try {
    return sessionStorage.getItem(`shannian_draft_note_${id}`);
  } catch {
    return null;
  }
}

export function ReadingPane({
  card,
  categories,
  inboxCount = 0,
  selectedCount = 0,
  selectedCards = [],
  batchMode = false,
  onExitBatch,
  onRemoveFromBatch,
  onBatchAction,
  onBatchChangeCategory,
  onOrganize,
  onTrash,
  onUpdateCard,
  lastOrganizedCard,
  onUndoOrganize,
  organizingPending = false,
}: ReadingPaneProps) {
  // Serialized write queue for mutation safety
  const writeTailRef = useRef<Promise<unknown>>(Promise.resolve());
  const activeCardIdRef = useRef<string | null>(card?.id || null);
  activeCardIdRef.current = card?.id || null;

  // Title and Author editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingAuthor, setEditingAuthor] = useState(false);
  const [authorDraft, setAuthorDraft] = useState("");

  // Per-card isolated note saving state & buffers
  const pendingNotesRef = useRef<Map<string, string>>(new Map());
  const noteTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const noteRevisionRef = useRef<Map<string, number>>(new Map());
  const [noteDraft, setNoteDraft] = useState("");
  const [noteStatus, setNoteStatus] = useState<"saved" | "saving" | "failed">("saved");

  // Accordion & dialog states
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Reliable flush of notes for a specific card ID
  const flushNoteSave = async (targetCardId: string): Promise<FlashCard | null> => {
    if (!pendingNotesRef.current.has(targetCardId)) return null;
    const textToSave = pendingNotesRef.current.get(targetCardId)!;
    const rev = (noteRevisionRef.current.get(targetCardId) || 0) + 1;
    noteRevisionRef.current.set(targetCardId, rev);

    // Save to storage for crash/unmount safety
    saveDraftToStorage(targetCardId, textToSave);

    const write = writeTailRef.current.then(
      () => api.updateCard(targetCardId, { note: textToSave || null }),
      () => api.updateCard(targetCardId, { note: textToSave || null })
    );
    writeTailRef.current = write.then(() => undefined, () => undefined);

    try {
      const res = await write;
      // If this was the latest revision and no newer draft was typed
      if (
        noteRevisionRef.current.get(targetCardId) === rev &&
        pendingNotesRef.current.get(targetCardId) === textToSave
      ) {
        pendingNotesRef.current.delete(targetCardId);
        clearDraftFromStorage(targetCardId);
        if (activeCardIdRef.current === targetCardId) {
          setNoteStatus("saved");
        }
      } else {
        // Newer draft exists! Keep status as saving
        if (activeCardIdRef.current === targetCardId) {
          setNoteStatus("saving");
        }
      }
      onUpdateCard(res.card);
      return res.card;
    } catch (err) {
      if (activeCardIdRef.current === targetCardId) {
        setNoteStatus("failed");
      }
      toast.error(err instanceof Error ? err.message : "保存批注失败");
      return null;
    }
  };

  // Card switch lifecycle: flush old card note, initialize new card (with draft recovery)
  const prevCardIdRef = useRef<string | null>(null);
  useEffect(() => {
    const oldId = prevCardIdRef.current;
    const newId = card?.id || null;

    if (oldId && oldId !== newId && pendingNotesRef.current.has(oldId)) {
      if (noteTimersRef.current.has(oldId)) {
        clearTimeout(noteTimersRef.current.get(oldId)!);
        noteTimersRef.current.delete(oldId);
      }
      void flushNoteSave(oldId);
    }

    prevCardIdRef.current = newId;

    if (card) {
      setTitleDraft(card.title || cardHeadline(card));
      setEditingTitle(false);
      setAuthorDraft(card.author || "");
      setEditingAuthor(false);
      setEvidenceOpen(false);
      setCategoryDropdownOpen(false);
      setMoreMenuOpen(false);

      // Check if there is an unflushed draft in memory or in session storage
      const cachedDraft = getDraftFromStorage(card.id);
      if (pendingNotesRef.current.has(card.id)) {
        setNoteDraft(pendingNotesRef.current.get(card.id)!);
        setNoteStatus("saving");
      } else if (cachedDraft !== null && cachedDraft !== (card.note || "")) {
        pendingNotesRef.current.set(card.id, cachedDraft);
        setNoteDraft(cachedDraft);
        setNoteStatus("saving");
        // Flush cached draft
        void flushNoteSave(card.id);
      } else {
        setNoteDraft(card.note || "");
        setNoteStatus("saved");
      }
    }
  }, [card?.id]);

  // Clean up timers on unmount & flush all pending
  useEffect(() => {
    return () => {
      noteTimersRef.current.forEach((t) => clearTimeout(t));
      noteTimersRef.current.clear();
      pendingNotesRef.current.forEach((_, cardId) => {
        void flushNoteSave(cardId);
      });
    };
  }, []);

  const handleNoteChange = (text: string) => {
    if (!card) return;
    const cardId = card.id;
    pendingNotesRef.current.set(cardId, text);
    setNoteDraft(text);
    setNoteStatus("saving");
    saveDraftToStorage(cardId, text);

    if (noteTimersRef.current.has(cardId)) {
      clearTimeout(noteTimersRef.current.get(cardId)!);
    }
    const timer = setTimeout(() => {
      noteTimersRef.current.delete(cardId);
      void flushNoteSave(cardId);
    }, 450);
    noteTimersRef.current.set(cardId, timer);
  };

  const handleSaveAuthor = async () => {
    if (!card) return;
    const cardId = card.id;
    const newAuthor = authorDraft.trim() || null;

    const write = writeTailRef.current.then(
      () => api.updateCard(cardId, { author: newAuthor }),
      () => api.updateCard(cardId, { author: newAuthor })
    );
    writeTailRef.current = write.then(() => undefined, () => undefined);

    try {
      const res = await write;
      if (activeCardIdRef.current === cardId) {
        onUpdateCard(res.card);
        setEditingAuthor(false);
      }
      toast.success("作者已更新");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "修改作者失败");
    }
  };

  const handleSaveTitle = async () => {
    if (!card) return;
    const cardId = card.id;
    const newTitle = titleDraft.trim() || null;

    const write = writeTailRef.current.then(
      () => api.updateCard(cardId, { title: newTitle }),
      () => api.updateCard(cardId, { title: newTitle })
    );
    writeTailRef.current = write.then(() => undefined, () => undefined);

    try {
      const res = await write;
      if (activeCardIdRef.current === cardId) {
        onUpdateCard(res.card);
        setEditingTitle(false);
      }
      toast.success("标题已修改");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "修改标题失败");
    }
  };

  const handleCategorySelect = async (catId: string) => {
    if (!card) return;
    const cardId = card.id;
    setCategoryDropdownOpen(false);

    const write = writeTailRef.current.then(
      () => api.updateCard(cardId, { categoryId: catId }),
      () => api.updateCard(cardId, { categoryId: catId })
    );
    writeTailRef.current = write.then(() => undefined, () => undefined);

    try {
      const res = await write;
      if (activeCardIdRef.current === cardId) {
        onUpdateCard(res.card);
      }
      toast.success("分类已更新");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新分类失败");
    }
  };

  // Export to Obsidian: locks busy state, awaits entire write queue, aborts if note save failed!
  const handleExportObsidian = async () => {
    if (!card || exporting) return;
    const cardId = card.id;
    setExporting(true);

    try {
      // Wait for any queued writes
      await writeTailRef.current;

      // If note has pending edits, flush now and verify success
      if (pendingNotesRef.current.has(cardId)) {
        const saved = await flushNoteSave(cardId);
        if (!saved) {
          toast.error("批注保存失败，已停止导出，请重试");
          return;
        }
      }

      await api.exportObsidian(cardId);
      toast.success("已成功导出至 Obsidian");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "请先配置 MinIO / Obsidian 存储");
    } finally {
      setExporting(false);
    }
  };

  const handleRetryAi = async () => {
    if (!card) return;
    try {
      const res = await api.retryEnrich(card.id);
      onUpdateCard(res.card);
      toast.success("已请求重新提取 AI 摘要");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重试 AI 失败");
    }
  };

  // 1. Batch Operation View (Figma 96:260)
  if (batchMode) {
    return (
      <div className="flex-1 overflow-y-auto scroll-thin bg-[#f9fafb] dark:bg-[#0e1218] p-6 lg:p-10">
        <div className="max-w-[840px] mx-auto space-y-6">
          <div className="bg-white dark:bg-[#14161c] border border-[#e6e9ec] dark:border-[#23262f] rounded-[8px] p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
            <div className="text-[14px] font-bold text-[#111827] dark:text-white">
              已选择 {selectedCount} 项卡片
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-[12px] bg-[#f2f4f6] dark:bg-[#21262d] border-[#e6e9ec] dark:border-[#30363d]"
                  onClick={() => setCategoryDropdownOpen(!categoryDropdownOpen)}
                >
                  批量移动分类 ▾
                </Button>
                {categoryDropdownOpen && (
                  <div className="absolute left-0 mt-1 w-40 rounded-md bg-white dark:bg-[#1f242d] border border-[#e6e9ec] dark:border-[#30363d] shadow-lg z-30 py-1">
                    {categories.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-xs text-[#111827] dark:text-[#e5e8eb] hover:bg-[#f2f4f6] dark:hover:bg-[#2a303c] cursor-pointer"
                        onClick={() => {
                          onBatchChangeCategory?.(c.id);
                          setCategoryDropdownOpen(false);
                        }}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Button
                size="sm"
                variant="outline"
                className="h-8 text-[12px] bg-[#f2f4f6] dark:bg-[#21262d] border-[#e6e9ec] dark:border-[#30363d]"
                onClick={() => onBatchAction?.("retry")}
              >
                <Sparkles className="size-3.5 mr-1" />
                批量重试 AI
              </Button>

              <Button
                size="sm"
                variant="destructive"
                className="h-8 text-[12px] bg-[#dc2626] text-white hover:bg-rose-700"
                onClick={() => onBatchAction?.("trash")}
              >
                <Trash2 className="size-3.5 mr-1" />
                批量丢弃
              </Button>

              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-[12px] text-[#6b7686] dark:text-[#9ca6b5]"
                onClick={onExitBatch}
              >
                ✕ 退出批量
              </Button>
            </div>
          </div>

          <div className="bg-white dark:bg-[#14161c] border border-[#e6e9ec] dark:border-[#23262f] rounded-[8px] p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-[16px] font-bold text-[#111827] dark:text-white">
                批量操作清单预览 (POST /api/cards/bulk)
              </h3>
              <p className="text-[13px] text-[#6b7686] dark:text-[#9ca6b5] mt-1">
                批量接口支持 action: 'organize' | 'trash' | 'retry'，保留状态卡片同样可进行重分类或移入回收站。
              </p>
            </div>

            <div className="space-y-3 pt-2">
              {selectedCards.map((sc, idx) => (
                <div
                  key={sc.id}
                  className="bg-[#f2f4f6] dark:bg-[#1a1d24] border border-[#eff1f3] dark:border-[#2b313a] rounded-[6px] p-3.5 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-bold text-[14px] text-[#9ca6b5] shrink-0 font-sans">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <div className="font-bold text-[14px] text-[#111827] dark:text-white truncate">
                        {cardHeadline(sc)}
                      </div>
                      <div className="text-[12px] text-[#9ca6b5] truncate mt-0.5">
                        来源: {sc.platform === "x" ? `X / @${sc.author || ""}` : sc.url || "随手记"}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveFromBatch?.(sc.id)}
                    className="text-[12px] text-[#6b7686] hover:text-[#dc2626] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                  >
                    移除选择 ✕
                  </button>
                </div>
              ))}
              {selectedCards.length === 0 && (
                <div className="py-12 text-center text-sm text-[#9ca6b5]">
                  请在左侧勾选要批量操作的卡片
                </div>
              )}
            </div>

            <div className="bg-[#fafafc] dark:bg-[#181b22] border border-[#e6e9ec] dark:border-[#2b313a] rounded-[6px] p-4 text-[12px] leading-relaxed text-[#6b7686] dark:text-[#9ca6b5] space-y-1.5 mt-6">
              <div className="font-bold text-[#111827] dark:text-white text-[13px] mb-2 flex items-center gap-1.5">
                <span className="text-amber-600 font-bold">●</span> 核心设计与数据架构说明
              </div>
              <p>1. 保留 (organized) 与 Obsidian 导出完全解耦：'已保留' 代表完成分流归档进入知识库，不强制导出到外部；</p>
              <p>2. 导出到 Obsidian 为次级独立操作 (POST /api/cards/:id/obsidian)，依赖已配置的 MinIO/S3 存储桶，非本地路径同步；</p>
              <p>3. 批量丢弃仅作软删除 (deletedAt 标记)，不会触发 X 平台取消书签，进入回收站后可完整恢复。</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. Empty State View (Figma 96:3)
  if (!card) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-[#f9fafb] dark:bg-[#0e1218]">
        <div className="bg-white dark:bg-[#14161c] border border-[#e6e9ec] dark:border-[#23262f] rounded-[12px] p-8 max-w-[480px] w-full shadow-sm text-center">
          <div className="size-12 rounded-full bg-[#f0f5ff] dark:bg-[#1e293b] text-[#1e5bbf] dark:text-[#60a5fa] flex items-center justify-center mx-auto mb-4 text-xl">
            ⚡
          </div>
          <h2 className="text-[17px] font-bold text-[#111827] dark:text-white">
            收件箱待分流 · {inboxCount} 条闪念
          </h2>
          <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5] mt-1.5 mb-6">
            从左侧选择一条闪念开始阅读，或使用极速键盘流推进：
          </p>

          <div className="space-y-2 text-left text-[12px]">
            <div className="flex items-center gap-3 bg-[#f2f4f6] dark:bg-[#1a1d24] px-3.5 py-2.5 rounded-[6px]">
              <kbd className="px-2 py-0.5 rounded bg-white dark:bg-[#242a35] border border-[#e6e9ec] dark:border-[#374151] font-mono text-[11px] font-bold shadow-2xs">
                J / K
              </kbd>
              <span className="text-[#546378] dark:text-[#9ca6b5]">在收件箱中上下移动光标</span>
            </div>

            <div className="flex items-center gap-3 bg-[#f2f4f6] dark:bg-[#1a1d24] px-3.5 py-2.5 rounded-[6px]">
              <kbd className="px-2 py-0.5 rounded bg-white dark:bg-[#242a35] border border-[#e6e9ec] dark:border-[#374151] font-mono text-[11px] font-bold shadow-2xs">
                Enter
              </kbd>
              <span className="text-[#546378] dark:text-[#9ca6b5]">保留当前卡片</span>
            </div>

            <div className="flex items-center gap-3 bg-[#f2f4f6] dark:bg-[#1a1d24] px-3.5 py-2.5 rounded-[6px]">
              <kbd className="px-2 py-0.5 rounded bg-white dark:bg-[#242a35] border border-[#e6e9ec] dark:border-[#374151] font-mono text-[11px] font-bold shadow-2xs">
                Delete
              </kbd>
              <span className="text-[#546378] dark:text-[#9ca6b5]">软删除至回收站 (可在回收站还原)</span>
            </div>

            <div className="flex items-center gap-3 bg-[#f2f4f6] dark:bg-[#1a1d24] px-3.5 py-2.5 rounded-[6px]">
              <kbd className="px-2 py-0.5 rounded bg-white dark:bg-[#242a35] border border-[#e6e9ec] dark:border-[#374151] font-mono text-[11px] font-bold shadow-2xs">
                + 录入 / C
              </kbd>
              <span className="text-[#546378] dark:text-[#9ca6b5]">快速唤起链接或想法捕获弹窗</span>
            </div>

            <div className="flex items-center gap-3 bg-[#f2f4f6] dark:bg-[#1a1d24] px-3.5 py-2.5 rounded-[6px]">
              <kbd className="px-2 py-0.5 rounded bg-white dark:bg-[#242a35] border border-[#e6e9ec] dark:border-[#374151] font-mono text-[11px] font-bold shadow-2xs">
                ⌘ K
              </kbd>
              <span className="text-[#546378] dark:text-[#9ca6b5]">全局检索历史卡片、作者与全文</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. Card Active Reading View (Figma 103:2, 103:604: width 600px, title 22px leading-32, summary 18px leading-31)
  const isOrganized = card.status === "organized" || card.status === "deposited";
  const currentCategory = categories.find((c) => c.id === card.categoryId);
  const currentCategoryName = currentCategory ? currentCategory.name : "未分类";

  let sourceBadge = "网页文章";
  if (card.platform === "x") sourceBadge = "X 推文原件";
  else if (!card.url) sourceBadge = "纯想法速记";

  const videoCount = card.media?.filter((m) => m.type === "video" || m.type === "gif").length || 0;
  const imageCount = card.media?.filter((m) => m.type === "image").length || 0;

  let basisText = "推文正文";
  if (card.summaryBasis === "description") basisText = "页面描述";
  else if (card.summaryBasis === "metadata") basisText = "页面元数据";
  else if (card.contentExcerpt) basisText = "正文摘录";

  const evidenceContent = card.contentExcerpt || card.description || "";

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-[#14161c] overflow-hidden relative">
      {/* Scrollable Reading Content - Figma container strictly 600px */}
      <div className="flex-1 overflow-y-auto scroll-thin px-4 sm:px-6 py-8 pb-44 sm:pb-32">
        <div data-testid="reading-content" className="w-full max-w-[600px] mx-auto space-y-4 [overflow-wrap:anywhere]">
          {/* Metadata Header Row (Figma 103:4) */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] h-[24px]">
            <div className="flex items-center gap-2 min-w-0">
              <span className="bg-[#eef4fe] dark:bg-[#1e293b] text-[#1e5bbf] dark:text-[#60a5fa] px-2 py-0.5 rounded-[3px] font-medium text-[11px]">
                {sourceBadge}
              </span>

              {/* Author edit / view */}
              {editingAuthor ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    autoFocus
                    value={authorDraft}
                    onChange={(e) => setAuthorDraft(e.target.value)}
                    placeholder="作者用户名"
                    className="h-6 w-28 text-[11px] px-1.5"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleSaveAuthor();
                      } else if (e.key === "Escape") {
                        setAuthorDraft(card.author || "");
                        setEditingAuthor(false);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleSaveAuthor}
                    className="text-[10px] text-[#1e5bbf] font-medium hover:underline cursor-pointer"
                  >
                    完成
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthorDraft(card.author || "");
                      setEditingAuthor(false);
                    }}
                    className="text-[10px] text-[#9ca6b5] hover:underline cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingAuthor(true)}
                  className="text-[#546378] dark:text-[#9ca6b5] hover:text-[#1e5bbf] font-sans truncate cursor-pointer group flex items-center gap-1"
                  title="点击编辑作者"
                >
                  <span>{card.author ? `@${card.author.replace(/^@/, "")}` : "添加作者"}</span>
                  <Pencil className="size-2.5 opacity-0 group-hover:opacity-60" />
                </button>
              )}

              {card.url && (
                <a
                  href={card.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[#546378] dark:text-[#9ca6b5] hover:text-[#1e5bbf] transition-colors flex items-center gap-0.5 truncate max-w-[200px]"
                >
                  <span className="truncate">{card.url}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              )}
            </div>

            <div className="text-[#9ca6b5] text-[11px] font-sans whitespace-nowrap">
              {card.createdAt ? `${new Date(card.createdAt).toLocaleDateString()} 捕获` : ""}
            </div>
          </div>

          {/* Title Area: Figma 103:682 (text 22px, leading 32px, bold, 600px width) */}
          {editingTitle ? (
            <div className="space-y-2 w-full">
              <Input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="text-[20px] font-serif font-bold h-auto py-1.5"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSaveTitle();
                  } else if (e.key === "Escape") {
                    setTitleDraft(card.title || cardHeadline(card));
                    setEditingTitle(false);
                  }
                }}
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleSaveTitle}>
                  完成
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setTitleDraft(card.title || cardHeadline(card));
                    setEditingTitle(false);
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <h1
              role="heading"
              aria-level={1}
              onClick={() => setEditingTitle(true)}
              className="w-full font-reading text-[18px] sm:text-[22px] font-bold text-[#111827] dark:text-white leading-[32px] cursor-pointer hover:text-[#1e5bbf] dark:hover:text-[#60a5fa] transition-colors group flex items-start justify-between gap-2"
              title="点击编辑标题"
            >
              <span>{card.title || cardHeadline(card)}</span>
              <Pencil className="size-4 opacity-0 group-hover:opacity-60 transition-opacity shrink-0 mt-1.5 text-[#9ca6b5]" />
            </h1>
          )}

          {/* Media Attachments Bar & Previews with real playable video */}
          {(videoCount > 0 || imageCount > 0) && (
            <div className="space-y-3 w-full">
              <div className="bg-[#f2f4f6] dark:bg-[#1a1d24] px-3 py-1.5 rounded-[4px] text-[11px] text-[#616b7a] dark:text-[#9ca6b5] flex items-center justify-between">
                <span>
                  <Paperclip className="size-3.5 inline mr-1 text-[#6b7686]" /> 附带 {videoCount > 0 ? `${videoCount} 个原始视频与 ` : ""}
                  {imageCount} 张图片
                </span>
                {card.url && (
                  <a
                    href={card.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[#1e5bbf] dark:text-[#60a5fa] hover:underline flex items-center gap-0.5"
                  >
                    在原平台查看 <ExternalLink className="size-3" />
                  </a>
                )}
              </div>

              {card.media && card.media.length > 0 && (
                <div className="grid grid-cols-2 gap-2 rounded-lg overflow-hidden border border-[#e6e9ec] dark:border-[#23262f] p-1 bg-[#f9fafb] dark:bg-[#161b22]">
                  {card.media.map((m, idx) => (
                    <div
                      key={idx}
                      className="relative aspect-video rounded overflow-hidden bg-black/5 dark:bg-black/20"
                    >
                      {m.type === "image" ? (
                        <img
                          src={m.url}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : m.url ? (
                        <video
                          src={m.url}
                          poster={m.posterUrl || undefined}
                          controls
                          className="size-full object-contain bg-black rounded"
                          preload="metadata"
                        />
                      ) : (
                        <div className="size-full flex items-center justify-center bg-black/10 text-[#6b7686]">
                          <Film className="size-8 opacity-60" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="h-px w-full bg-[#eef0f2] dark:bg-[#23262f]" />

          {/* AI Summary Section - Figma 103:687 (font-reading, text 18px, leading 31px, 600px width) */}
          <div className="space-y-2.5 w-full">
            <div className="flex items-center justify-between text-[12px] font-bold text-[#949eab]">
              <span>AI 核心摘要 · 依据: {basisText}</span>
              {card.aiStatus === "pending" && (
                <span className="text-amber-500 font-normal">生成中…</span>
              )}
              {card.aiStatus === "failed" && (
                <button
                  type="button"
                  onClick={handleRetryAi}
                  className="text-rose-500 hover:underline flex items-center gap-1 font-normal cursor-pointer"
                >
                  <RefreshCw className="size-3" /> 重试
                </button>
              )}
            </div>

            {card.summary ? (
              <p className="font-reading text-[16px] leading-[27px] sm:text-[18px] sm:leading-[31px] text-[#111827] dark:text-[#e5e8eb] select-text">
                {card.summary}
              </p>
            ) : (
              <p className="text-[14px] text-[#9ca6b5] italic leading-[24px]">
                {card.aiStatus === "pending"
                  ? "后台抓取与 AI 摘要生成中…"
                  : card.aiStatus === "failed"
                    ? "AI 摘要生成失败，可点击上方重试。"
                    : "暂无摘要，可在下方直接记录你的想法。"}
              </p>
            )}

            {/* Evidence Accordion (Figma 103:281 / 103:688) */}
            {evidenceContent && (
              <div className="pt-1.5 w-full">
                <button
                  type="button"
                  onClick={() => setEvidenceOpen(!evidenceOpen)}
                  className="w-full bg-[#fbfcfe] dark:bg-[#1a1d24] border border-[#eef0f2] dark:border-[#2b313a] rounded-[6px] px-3.5 py-2 text-left text-[12px] font-bold text-[#616b7a] dark:text-[#9ca6b5] hover:bg-[#f2f4f6] transition-colors flex items-center justify-between cursor-pointer"
                >
                  <span>
                    {evidenceOpen ? "▼" : "▶"} 查看提取依据对照 ({basisText})
                  </span>
                  <ChevronDown
                    className={cn("size-4 transition-transform", evidenceOpen && "rotate-180")}
                  />
                </button>

                {evidenceOpen && (
                  <div className="mt-2 p-3.5 bg-[#f9fafb] dark:bg-[#161b22] border border-[#eef0f2] dark:border-[#2b313a] rounded-[6px] text-[13px] leading-relaxed text-[#546378] dark:text-[#9ca6b5] max-h-64 overflow-y-auto scroll-thin select-text whitespace-pre-wrap">
                    {evidenceContent}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="h-px w-full bg-[#eef0f2] dark:bg-[#23262f]" />

          {/* User Notes Section (Figma 103:691 / 103:694) */}
          <div className="space-y-2 w-full">
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-bold text-[#949eab]">我的想法与批注</span>
              <div className="flex items-center gap-2">
                {noteStatus === "failed" && (
                  <button
                    type="button"
                    onClick={() => card && void flushNoteSave(card.id)}
                    className="text-[11px] text-rose-600 hover:underline font-medium cursor-pointer flex items-center gap-1"
                  >
                    <AlertCircle className="size-3" /> 保存失败，点击重试
                  </button>
                )}
                {noteStatus === "saving" && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400">正在保存…</span>
                )}
                {noteStatus === "saved" && (
                  <span className="text-[11px] text-[#949eab]">已保存</span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px] text-[#6b7686]"
                  onClick={() => card && void flushNoteSave(card.id)}
                >
                  保存
                </Button>
              </div>
            </div>

            <Textarea
              rows={5}
              value={noteDraft}
              onChange={(e) => handleNoteChange(e.target.value)}
              onBlur={() => card && void flushNoteSave(card.id)}
              placeholder="写下灵感、判断或纠正，自动安全保存到本地…"
              className="w-full rounded-[6px] border border-[#e6e9ec] dark:border-[#2b313a] bg-white dark:bg-[#14161c] p-3 text-[14px] leading-relaxed text-[#111827] dark:text-[#e5e8eb] placeholder:text-[#9ca6b5] focus-visible:ring-1 focus-visible:ring-[#1e5bbf]"
            />
          </div>
        </div>
      </div>

      {/* Floating Bottom Action Dock (Figma 103:149, 103:695) */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-[600px] px-2 pointer-events-none z-20 flex flex-col items-center gap-2">
        {/* Undo feedback toast if previous card was organized */}
        {lastOrganizedCard && onUndoOrganize && (
          <div className="pointer-events-auto bg-[#182233] text-white px-4 py-2 rounded-[6px] shadow-lg flex items-center justify-between gap-6 text-[12px] animate-in fade-in slide-in-from-bottom-2 duration-150">
            <span>✓ 上一条已保留 · 自动跳至下一条</span>
            <button
              type="button"
              onClick={onUndoOrganize}
              className="font-bold text-[#60a5fa] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <Undo2 className="size-3.5" /> 撤销
            </button>
          </div>
        )}

        {/* Action Dock Bar */}
        <div className="pointer-events-auto w-full bg-white dark:bg-[#14161c] border border-[#e6e9ec] dark:border-[#23262f] rounded-[8px] p-2 shadow-lg flex flex-wrap items-center justify-between gap-2">
          {/* Trash button */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onTrash(card)}
            className="h-[36px] px-3 text-[12px] text-[#6b7686] dark:text-[#9ca6b5] hover:text-[#dc2626] hover:bg-rose-50 dark:hover:bg-rose-950/40"
            title="快捷键 Del"
          >
            ✕ 丢弃 Del
          </Button>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {/* Category dropdown selector */}
            <div className="relative">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCategoryDropdownOpen(!categoryDropdownOpen)}
                className="h-[36px] px-3 text-[12px] border-[#e6e9ec] dark:border-[#2b313a] text-[#111827] dark:text-white"
              >
                分类: {currentCategoryName} ▾
              </Button>
              {categoryDropdownOpen && (
                <div className="absolute bottom-full mb-1 left-0 w-36 rounded-md bg-white dark:bg-[#1f242d] border border-[#e6e9ec] dark:border-[#30363d] shadow-xl z-40 py-1">
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full text-left px-3 py-1.5 text-xs text-[#111827] dark:text-[#e5e8eb] hover:bg-[#f2f4f6] dark:hover:bg-[#2a303c] cursor-pointer"
                      onClick={() => handleCategorySelect(c.id)}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Export to Obsidian */}
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportObsidian}
              disabled={exporting}
              className="h-[36px] px-3 text-[12px] border-[#e6e9ec] dark:border-[#2b313a] text-[#111827] dark:text-white"
            >
              {exporting ? "正在导出…" : "导出到 Obsidian"}
            </Button>

            {/* More menu */}
            <div className="relative">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                className="size-[36px] p-0 text-[#6b7686]"
                title="更多操作"
              >
                <MoreHorizontal className="size-4" />
              </Button>
              {moreMenuOpen && (
                <div className="absolute bottom-full mb-1 right-0 w-44 rounded-md bg-white dark:bg-[#1f242d] border border-[#e6e9ec] dark:border-[#30363d] shadow-xl z-40 py-1">
                  <button
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-xs text-[#111827] dark:text-[#e5e8eb] hover:bg-[#f2f4f6] dark:hover:bg-[#2a303c] flex items-center gap-2 cursor-pointer"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      handleRetryAi();
                    }}
                  >
                    <RefreshCw className="size-3.5" /> 重新提取 AI 摘要
                  </button>
                  {card.url && (
                    <a
                      href={card.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="w-full text-left px-3 py-1.5 text-xs text-[#111827] dark:text-[#e5e8eb] hover:bg-[#f2f4f6] dark:hover:bg-[#2a303c] flex items-center gap-2"
                      onClick={() => setMoreMenuOpen(false)}
                    >
                      <ExternalLink className="size-3.5" /> 打开原始链接
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Organize / Keep button (exact text "保留" / "已保留") */}
            <Button
              size="sm"
              disabled={organizingPending}
              onClick={() => onOrganize(card)}
              className={cn(
                "h-[36px] px-4 font-bold text-[13px] rounded-[6px] shadow-sm transition-all",
                isOrganized
                  ? "bg-[#06784c] hover:bg-[#05603d] text-white"
                  : "bg-[#182233] hover:bg-[#253247] text-white dark:bg-white dark:text-[#182233]"
              )}
              title="快捷键 Enter"
            >
              <Check className="size-4 mr-1 stroke-[3]" />
              {isOrganized ? "已保留" : "保留"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
