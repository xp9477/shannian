import React, { useEffect, useRef, useState } from "react";
import type { FlashCard } from "@shannian/shared";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { FileText, Link2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface CaptureModalProps {
  open: boolean;
  onClose: () => void;
  categories: { id: string; name: string }[];
  onCardCreated: (card: FlashCard) => void;
}

export function CaptureModal({
  open,
  onClose,
  categories,
  onCardCreated,
}: CaptureModalProps) {
  const [tab, setTab] = useState<"url" | "thought">("url");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [thoughtText, setThoughtText] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const urlInputRef = useRef<HTMLInputElement>(null);
  const thoughtInputRef = useRef<HTMLTextAreaElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Focus trap & restore
  useEffect(() => {
    if (open) {
      previousActiveElementRef.current = document.activeElement as HTMLElement;
      setTimeout(() => {
        if (tab === "url") {
          urlInputRef.current?.focus();
        } else {
          thoughtInputRef.current?.focus();
        }
      }, 50);
    } else {
      if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
      }
      // Reset form
      setUrl("");
      setNote("");
      setThoughtText("");
    }
  }, [open, tab]);

  // Handle Esc key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const handleSubmit = async () => {
    if (submitting) return;

    if (tab === "url") {
      const trimmedUrl = url.trim();
      if (!trimmedUrl) {
        toast.error("请输入有效链接或文本");
        return;
      }
      setSubmitting(true);
      try {
        // If it starts with http/https, create as URL; otherwise if user pasted pure thought here, handle gracefully
        const isHttp = /^https?:\/\//i.test(trimmedUrl);
        const res = await api.createCard({
          url: isHttp ? trimmedUrl : undefined,
          text: !isHttp ? trimmedUrl : undefined,
          note: note.trim() || undefined,
        });

        if (selectedCategoryId) {
          try {
            const updated = await api.updateCard(res.card.id, {
              categoryId: selectedCategoryId,
            });
            onCardCreated(updated.card);
          } catch {
            onCardCreated(res.card);
          }
        } else {
          onCardCreated(res.card);
        }

        toast.success(res.existing ? "已更新已有卡片" : "已录入收件箱");
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "录入失败");
      } finally {
        setSubmitting(false);
      }
    } else {
      const trimmedThought = thoughtText.trim();
      if (!trimmedThought) {
        toast.error("写下你的想法或灵感");
        return;
      }
      setSubmitting(true);
      try {
        const res = await api.createCard({
          text: trimmedThought,
        });

        if (selectedCategoryId) {
          try {
            const updated = await api.updateCard(res.card.id, {
              categoryId: selectedCategoryId,
            });
            onCardCreated(updated.card);
          } catch {
            onCardCreated(res.card);
          }
        } else {
          onCardCreated(res.card);
        }

        toast.success("灵感速记已保存");
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "录入失败");
      } finally {
        setSubmitting(false);
      }
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px] animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="capture-title"
    >
      <div className="bg-white dark:bg-[#14161c] border border-[#e6e9ec] dark:border-[#23262f] rounded-[12px] shadow-2xl max-w-[620px] w-full overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-[#eff1f3] dark:border-[#23262f] flex items-start justify-between">
          <div>
            <h2 id="capture-title" className="text-[16px] font-bold text-[#111827] dark:text-white">
              录入新闪念 (Quick Capture)
            </h2>
            <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5] mt-1">
              支持解析推文/网页正文，或直接录入纯文本想法；与全局搜索严格隔离，避免误回车创建记录。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-7 rounded-[6px] bg-[#f2f4f6] dark:bg-[#21262d] text-[#6b7686] dark:text-[#9ca6b5] hover:text-[#111827] dark:hover:text-white flex items-center justify-center transition-colors"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="px-6 pt-4 pb-2">
          <div className="grid grid-cols-2 p-1 bg-[#f2f4f6] dark:bg-[#1a1d24] rounded-[6px] text-[12px]">
            <button
              type="button"
              onClick={() => setTab("url")}
              className={cn(
                "py-1.5 rounded-[5px] font-medium transition-colors",
                tab === "url"
                  ? "bg-white dark:bg-[#232936] text-[#111827] dark:text-white shadow-2xs font-bold"
                  : "text-[#6b7686] dark:text-[#9ca6b5] hover:text-[#111827]"
              )}
            >
              <Link2 className="size-3.5 inline mr-1 text-[#1e5bbf]" /> 网页 / 推文链接 (URL)
            </button>
            <button
              type="button"
              onClick={() => setTab("thought")}
              className={cn(
                "py-1.5 rounded-[5px] font-medium transition-colors",
                tab === "thought"
                  ? "bg-white dark:bg-[#232936] text-[#111827] dark:text-white shadow-2xs font-bold"
                  : "text-[#6b7686] dark:text-[#9ca6b5] hover:text-[#111827]"
              )}
            >
              <FileText className="size-3.5 inline mr-1 text-[#6b7686]" /> 纯想法 / 灵感速记
            </button>
          </div>
        </div>

        {/* Body Form */}
        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto scroll-thin">
          {tab === "url" ? (
            <>
              <div>
                <label className="block text-[12px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1.5">
                  目标链接 (URL)
                </label>
                <Input
                  ref={urlInputRef}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://x.com/... 或任意网页 URL，亦可粘贴想法"
                  className="h-[42px] text-[13px] border-[#2666d9] dark:border-[#3b82f6] focus-visible:ring-1 focus-visible:ring-[#2666d9]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                />
                <p className="text-[11px] text-[#9ca6b5] mt-1.5">
                  ⚡ 提交后将自动在后台抓取网页正文、元数据并触发 AI 摘要提取（可离线降级）。
                </p>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1.5">
                  我的随手想法 / 批注（可选）
                </label>
                <Textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="写下你关注该链接的理由、灵感或关联..."
                  className="text-[13px] border-[#e6e9ec] dark:border-[#2b313a]"
                />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-[12px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1.5">
                想法与灵感内容
              </label>
              <Textarea
                ref={thoughtInputRef}
                rows={6}
                value={thoughtText}
                onChange={(e) => setThoughtText(e.target.value)}
                placeholder="记录即时闪现的灵感、对话洞察或摘抄内容…"
                className="text-[14px] leading-relaxed border-[#2666d9] dark:border-[#3b82f6] focus-visible:ring-1"
              />
            </div>
          )}

          {/* Category Selector */}
          <div>
            <label className="block text-[12px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1.5">
              归属分类
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedCategoryId("")}
                className={cn(
                  "px-3 py-1 rounded-[14px] text-[11px] transition-colors",
                  selectedCategoryId === ""
                    ? "bg-[#182233] text-white font-medium dark:bg-white dark:text-[#182233]"
                    : "bg-[#f2f4f6] dark:bg-[#1f242d] text-[#6b7686] dark:text-[#9ca6b5] hover:bg-[#e5e7eb]"
                )}
              >
                未分类
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCategoryId(c.id)}
                  className={cn(
                    "px-3 py-1 rounded-[14px] text-[11px] transition-colors",
                    selectedCategoryId === c.id
                      ? "bg-[#182233] text-white font-medium dark:bg-white dark:text-[#182233]"
                      : "bg-[#f2f4f6] dark:bg-[#1f242d] text-[#6b7686] dark:text-[#9ca6b5] hover:bg-[#e5e7eb]"
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 px-6 border-t border-[#eff1f3] dark:border-[#23262f] bg-[#f2f4f6] dark:bg-[#1a1d24] flex items-center justify-between">
          <span className="text-[11px] text-[#9ca6b5] hidden sm:inline">
            快捷键: ⌘ + Enter 提交
          </span>

          <div className="flex items-center gap-3 ml-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="h-[36px] px-3.5 text-[12px] border-[#e6e9ec] dark:border-[#30363d]"
            >
              取消 (Esc)
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={submitting}
              onClick={handleSubmit}
              className="h-[36px] px-4 text-[12px] font-bold bg-[#182233] dark:bg-white text-white dark:text-[#182233] hover:bg-[#253247] shadow-sm"
            >
              {submitting ? "正在录入…" : "+ 录入并加入收件箱"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
