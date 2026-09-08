import React, { useEffect, useRef, useState } from "react";
import type { FlashCard } from "@shannian/shared";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DangerPurgeDialog } from "@/components/DangerPurgeDialog";
import { cardHeadline, formatCardTime } from "@/lib/card-display";

interface TrashModalProps {
  open: boolean;
  onClose: () => void;
  onRestoreCard?: (cardId: string) => void;
}

export function TrashModal({ open, onClose, onRestoreCard }: TrashModalProps) {
  const [items, setItems] = useState<FlashCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<FlashCard | null>(null);
  const [purgeErrorMsg, setPurgeErrorMsg] = useState<string>("");
  const busyActionRef = useRef<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.listCards({ trash: "1" });
      setItems(res.items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载回收站失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      load();
    }
  }, [open]);

  // Esc listener
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !purgeTarget) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, purgeTarget, onClose]);

  const handleRestore = async (card: FlashCard) => {
    if (busyActionRef.current.has(card.id)) return;
    busyActionRef.current.add(card.id);
    try {
      await api.restoreCard(card.id);
      toast.success("已恢复至收件箱");
      onRestoreCard?.(card.id);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "恢复失败");
    } finally {
      busyActionRef.current.delete(card.id);
    }
  };

  const handlePurge = async (card: FlashCard) => {
    if (!confirm("永久删除？不可撤销。若来自 X 书签，将尝试取消原平台收藏。")) {
      return;
    }
    if (busyActionRef.current.has(card.id)) return;
    busyActionRef.current.add(card.id);
    try {
      await api.deleteCard(card.id, true);
      toast.success("已永久删除");
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.body.error === "REVOKE_FAILED") {
        setPurgeTarget(card);
        setPurgeErrorMsg(String(err.body.message || ""));
      } else {
        toast.error(err instanceof Error ? err.message : "永久删除失败");
      }
    } finally {
      busyActionRef.current.delete(card.id);
    }
  };

  const handleForceDelete = async (cardId: string) => {
    try {
      await api.deleteCard(cardId, true, true);
      toast.success("已强制在本地永久删除");
      setPurgeTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "强制删除失败");
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px] animate-in fade-in duration-150 select-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trash-title"
      >
        <div className="bg-white dark:bg-[#14161c] border border-[#e6e9ec] dark:border-[#23262f] rounded-[12px] shadow-2xl max-w-[560px] w-full max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col">
          {/* Header (Figma 96:457) */}
          <div className="h-[56px] px-6 border-b border-[#eff1f3] dark:border-[#23262f] flex items-center justify-between shrink-0 bg-[#f2f4f6] dark:bg-[#1a1d24]">
            <h2 id="trash-title" className="text-[13px] font-bold text-[#111827] dark:text-white">
              回收站 (仅软删除 · {items.length} 条待清理)
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="size-7 rounded-[6px] bg-white dark:bg-[#21262d] text-[#6b7686] dark:text-[#9ca6b5] hover:text-[#111827] dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>

          {/* List of Soft-deleted Cards (Figma 96:459) */}
          <div className="flex-1 overflow-y-auto scroll-thin divide-y divide-[#eff1f3] dark:divide-[#23262f]">
            {items.length === 0 && (
              <div className="py-16 text-center text-[13px] text-[#9ca6b5]">
                回收站为空
              </div>
            )}
            {items.map((card) => {
              const headline = cardHeadline(card);
              let sourceMeta = "纯想法";
              if (card.platform === "x") {
                sourceMeta = `X / @${card.author || ""}`;
              } else if (card.url) {
                try {
                  sourceMeta = `Web / ${new URL(card.url).hostname}`;
                } catch {
                  sourceMeta = "Web";
                }
              }

              return (
                <div
                  key={card.id}
                  className="p-4 px-6 hover:bg-[#fafafc] dark:hover:bg-[#181c24] transition-colors flex flex-col gap-1.5"
                >
                  <div className="font-bold text-[13px] text-[#111827] dark:text-white truncate">
                    {headline}
                  </div>
                  <div className="text-[11px] text-[#9ca6b5]">
                    {sourceMeta} · {card.deletedAt ? formatCardTime(card.deletedAt) + "丢弃" : "已丢弃"}
                  </div>
                  <div className="flex items-center gap-4 pt-1 text-[12px]">
                    <button
                      type="button"
                      onClick={() => handleRestore(card)}
                      className="font-medium text-[#1a66cc] dark:text-[#58a6ff] hover:underline cursor-pointer"
                    >
                      ↩ 还原至收件箱
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePurge(card)}
                      className="font-medium text-[#dc2626] dark:text-[#f87171] hover:underline cursor-pointer"
                    >
                      永久删除 (Purge)
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="h-[52px] px-6 border-t border-[#eff1f3] dark:border-[#23262f] bg-[#f2f4f6] dark:bg-[#1a1d24] flex items-center justify-between shrink-0">
            <span className="text-[11px] text-[#9ca6b5]">
              永久删除将清除数据库记录；X 书签将联动撤回
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onClose}
              className="h-8 text-xs border-[#e6e9ec] dark:border-[#30363d]"
            >
              关闭
            </Button>
          </div>
        </div>
      </div>

      {/* Danger Purge Confirmation Dialog (Figma 96:475) */}
      {purgeTarget && (
        <DangerPurgeDialog
          card={purgeTarget}
          open={Boolean(purgeTarget)}
          errorMessage={purgeErrorMsg}
          onCancel={() => setPurgeTarget(null)}
          onForceDelete={handleForceDelete}
        />
      )}
    </>
  );
}
