import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FlashCard } from "@shannian/shared";
import { toast } from "sonner";
import { api, ApiError } from "../lib/api";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/ui/button";

export default function TrashPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<FlashCard[]>([]);
  const [inbox, setInbox] = useState(0);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const mountedRef = useRef(true);
  const actionsRef = useRef(new Set<string>());

  const load = useCallback(async () => {
    const [res, count, cats] = await Promise.all([
      api.listCards({ trash: "1" }),
      api.inboxCount(),
      api.categories(),
    ]);
    if (!mountedRef.current) return;
    setItems(res.items);
    setInbox(count.count);
    setCategories(cats.items);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load().catch((error) => {
      if (mountedRef.current) {
        toast.error(error instanceof Error ? error.message : "加载回收站失败");
      }
    });
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  return (
    <AppShell
      inboxCount={inbox}
      categories={categories}
      onFilterChange={() => navigate("/")}
    >
      <div className="w-full p-4 sm:p-6 lg:px-8">
        <h1 className="mb-1 text-lg font-semibold tracking-tight">回收站</h1>
        <p className="mb-4 text-xs text-[var(--color-muted-foreground)]">
          可恢复；永久删除不可撤销。
        </p>
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
          {items.length === 0 && (
            <div className="py-16 text-center text-sm text-[var(--color-muted-foreground)]">
              回收站是空的
            </div>
          )}
          {items.map((card) => (
            <div
              key={card.id}
              className="flex items-center gap-3 border-b border-[var(--color-border)] px-3 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {card.title || card.summary || card.note || card.url}
                </div>
                <div className="text-[11px] text-[var(--color-muted-foreground)]">
                  {card.deletedAt ? new Date(card.deletedAt).toLocaleString() : ""}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (actionsRef.current.has(card.id)) return;
                  actionsRef.current.add(card.id);
                  try {
                    await api.restoreCard(card.id);
                    toast.success("已恢复");
                    await load();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "恢复失败");
                  } finally {
                    actionsRef.current.delete(card.id);
                  }
                }}
              >
                恢复
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  if (!confirm("永久删除？不可撤销。若来自 X 书签，将尝试取消原平台收藏。")) return;
                  if (actionsRef.current.has(card.id)) return;
                  actionsRef.current.add(card.id);
                  try {
                    await api.deleteCard(card.id, true);
                    toast.success("已永久删除");
                    await load();
                  } catch (e) {
                    if (e instanceof ApiError && e.body.error === "REVOKE_FAILED") {
                      const msg = String(e.body.message || "取消原平台收藏失败");
                      if (
                        confirm(
                          `${msg}\n\n仍要仅删除闪念本地记录？（X 上可能仍保留书签）`
                        )
                      ) {
                        try {
                          await api.deleteCard(card.id, true, true);
                          toast.success("已强制删除本地记录");
                          await load();
                        } catch (e2) {
                          toast.error(String(e2));
                        }
                      }
                    } else {
                      toast.error(String(e));
                    }
                  } finally {
                    actionsRef.current.delete(card.id);
                  }
                }}
              >
                永久删除
              </Button>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
