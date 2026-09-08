import React from "react";
import type { FlashCard } from "@shannian/shared";
import { Button } from "@/components/ui/button";
import { cardHeadline } from "@/lib/card-display";

interface DangerPurgeDialogProps {
  card: FlashCard;
  open: boolean;
  onCancel: () => void;
  onForceDelete: (cardId: string) => void;
  errorMessage?: string;
}

export function DangerPurgeDialog({
  card,
  open,
  onCancel,
  onForceDelete,
  errorMessage,
}: DangerPurgeDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px] animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="danger-purge-title"
    >
      <div className="bg-white dark:bg-[#14161c] border border-[#e6e9ec] dark:border-[#23262f] rounded-[12px] shadow-2xl max-w-[560px] w-full overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col">
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3.5">
            <div className="size-11 rounded-full bg-rose-100 dark:bg-rose-950/50 flex items-center justify-center text-rose-600 dark:text-rose-400 text-xl shrink-0">
              ⚠️
            </div>
            <div className="min-w-0">
              <h2
                id="danger-purge-title"
                className="text-[16px] font-bold text-[#111827] dark:text-white"
              >
                永久删除卡片确认 (Permanent Purge)
              </h2>
              <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5] mt-1 truncate">
                卡片：“{cardHeadline(card)}” (ID: {card.id})
              </p>
            </div>
          </div>

          {/* RevokeFailedBox (Figma 96:480) */}
          <div className="bg-[#fef2f2] dark:bg-[#2d1517] border border-[#fccccc] dark:border-[#5c2429] rounded-[8px] p-4 text-left space-y-2">
            <div className="font-bold text-[12px] text-[#dc2626] dark:text-[#f87171] flex items-center gap-1.5">
              <span>🔴</span>
              <span>同步取消 X (Twitter) 书签失败 (REVOKE_FAILED)</span>
            </div>
            <p className="text-[12px] text-[#111827] dark:text-[#f3f4f6] leading-relaxed">
              {errorMessage ||
                "此卡片来源于 X 书签。系统按设定在永久删除时尝试调用 X 接口取消原推收藏，但返回错误：‘X 凭证已失效或遭遇平台请求限流’。原推书签依然保留在您的 X 账号中。"}
            </p>
            <p className="font-mono text-[11px] text-[#dc2626] dark:text-[#f87171] font-medium">
              错误码: REVOKE_FAILED · HTTP 409 Conflict
            </p>
          </div>

          <div className="space-y-1.5 text-[12px] text-[#6b7686] dark:text-[#9ca6b5] leading-relaxed">
            <div className="font-bold text-[#111827] dark:text-white">请选择处理方式：</div>
            <p>• 仅在本地永久删除：将清理本地数据库记录与图片缓存，忽略 X 平台联动；</p>
            <p>• 取消：保留在回收站中，待更新 X 凭证后重新尝试完整删除。</p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 px-6 border-t border-[#eff1f3] dark:border-[#23262f] bg-[#f2f4f6] dark:bg-[#1a1d24] flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="h-[36px] px-4 text-[12px] border-[#e6e9ec] dark:border-[#30363d]"
          >
            取消并保留
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onForceDelete(card.id)}
            className="h-[36px] px-4 text-[12px] font-bold bg-[#dc2626] hover:bg-rose-700 text-white shadow-sm"
          >
            仅在本地永久删除 (force=1)
          </Button>
        </div>
      </div>
    </div>
  );
}
