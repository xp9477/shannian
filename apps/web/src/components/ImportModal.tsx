import React, { useEffect, useRef, useState } from "react";
import type { ImportJob, PlatformImportPublic, XCredentialsPublic } from "@shannian/shared";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  onImportDone?: () => void;
}

export function ImportModal({ open, onClose, onImportDone }: ImportModalProps) {
  const [platforms, setPlatforms] = useState<PlatformImportPublic[]>([]);
  const [riskNote, setRiskNote] = useState("");
  const [creds, setCreds] = useState<XCredentialsPublic | null>(null);
  const [authToken, setAuthToken] = useState("");
  const [ct0, setCt0] = useState("");
  const [editingCreds, setEditingCreds] = useState(false);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [plats, x, currentJob] = await Promise.all([
        api.importPlatforms(),
        api.xCredentials(),
        api.xImportJob(),
      ]);
      setPlatforms(plats.items);
      setRiskNote(plats.riskNote || x.riskNote);
      setCreds(x.credentials);
      setJob(currentJob.job);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载导入数据失败");
    }
  };

  useEffect(() => {
    if (open) {
      load();
    }
  }, [open]);

  // Poll while job is running
  useEffect(() => {
    if (!open || job?.status !== "running") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const result = await api.xImportJob();
        if (!cancelled) {
          setJob(result.job);
          if (result.job?.status === "completed") {
            toast.success("X 书签同步已完成");
            onImportDone?.();
          }
        }
      } catch {
        // ignore polling errors
      } finally {
        if (!cancelled && job?.status === "running") {
          timer = setTimeout(poll, 1500);
        }
      }
    };

    timer = setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, job?.status]);

  // Esc listener
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleSaveCreds = async () => {
    setBusy(true);
    try {
      const res = await api.saveXCredentials({
        authToken: authToken || undefined,
        ct0: ct0 || undefined,
      });
      setCreds(res.credentials);
      setAuthToken("");
      setCt0("");
      setEditingCreds(false);
      toast.success("X 凭证已保存");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存凭证失败");
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    try {
      const res = await api.testX();
      if (res.ok) toast.success(res.message || "X 凭证连接有效");
      else toast.error(res.message || "X 连接失败");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "测试连接失败");
    } finally {
      setBusy(false);
    }
  };

  const handleClearCreds = async () => {
    if (!confirm("清除 X 凭证？之后导入与取消收藏将不可用。")) return;
    setBusy(true);
    try {
      await api.clearXCredentials();
      setCreds(null);
      setAuthToken("");
      setCt0("");
      toast.success("X 凭证已清除");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "清除凭证失败");
    } finally {
      setBusy(false);
    }
  };

  const handleCancelSync = async () => {
    setBusy(true);
    try {
      const res = await api.cancelXImport();
      setJob(res.job);
      toast.success("已取消同步任务");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "取消任务失败");
    } finally {
      setBusy(false);
    }
  };

  const handleStartSync = async (forceFull = false) => {
    setBusy(true);
    try {
      const res = await api.startXImport(forceFull);
      setJob(res.job);
      toast.success(forceFull ? "已启动全量重新扫描" : "已启动增量同步任务");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "启动同步失败");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px] animate-in fade-in duration-150 select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-title"
    >
      <div className="bg-white dark:bg-[#14161c] border border-[#e6e9ec] dark:border-[#23262f] rounded-[12px] shadow-2xl max-w-[760px] w-full max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col">
        {/* Header (Figma 96:385) */}
        <div className="h-[70px] px-7 border-b border-[#eff1f3] dark:border-[#23262f] flex items-center justify-between shrink-0">
          <div>
            <h2 id="import-title" className="text-[16px] font-bold text-[#111827] dark:text-white leading-none">
              平台收藏导入 (Platform Import)
            </h2>
            <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5] mt-1.5 leading-none">
              从外部平台同步已收藏内容至闪念收件箱，支持增量检索与源平台取消收藏联动
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-7 rounded-[6px] bg-[#f2f4f6] dark:bg-[#21262d] text-[#6b7686] dark:text-[#9ca6b5] hover:text-[#111827] dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto scroll-thin p-7 space-y-6">
          {/* X Platform Card (Figma 96:390) */}
          <div className="bg-white dark:bg-[#181c24] border border-[#e6e9ec] dark:border-[#2b313a] rounded-[8px] p-6 space-y-4 shadow-sm">
            {/* Title Line */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="font-bold text-[15px] text-[#111827] dark:text-white">
                  𝕏 X (Twitter) 书签同步
                </span>
                {creds?.hasAuthToken && creds?.hasCt0 ? (
                  <span className="bg-[#ecfbf2] dark:bg-[#064e3b]/30 text-[#06784c] dark:text-[#34d399] px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-[#06784c] dark:bg-[#34d399]" />
                    已连接凭证
                  </span>
                ) : (
                  <span className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 px-2 py-0.5 rounded text-[11px] font-medium">
                    未配置凭证
                  </span>
                )}
                <span className="bg-[#f2f4f6] dark:bg-[#21262d] text-[#6b7686] dark:text-[#9ca6b5] px-2 py-0.5 rounded text-[11px]">
                  支持取消书签 (Revoke)
                </span>
              </div>
            </div>

            {/* Creds Box */}
            <div className="bg-[#f2f4f6] dark:bg-[#1f242d] rounded-[6px] p-4 space-y-3">
              {editingCreds ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-[#546378] dark:text-[#9ca6b5] mb-1">
                        auth_token
                      </label>
                      <Input
                        type="password"
                        value={authToken}
                        onChange={(e) => setAuthToken(e.target.value)}
                        placeholder="从浏览器 Cookie 复制 auth_token"
                        className="h-8 text-xs bg-white dark:bg-[#14161c]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#546378] dark:text-[#9ca6b5] mb-1">
                        ct0 (CSRF Token)
                      </label>
                      <Input
                        type="password"
                        value={ct0}
                        onChange={(e) => setCt0(e.target.value)}
                        placeholder="从浏览器 Cookie 复制 ct0"
                        className="h-8 text-xs bg-white dark:bg-[#14161c]"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={handleSaveCreds}
                      disabled={busy}
                      className="h-7 text-xs bg-[#182233] text-white"
                    >
                      保存凭证
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingCreds(false)}
                      className="h-7 text-xs"
                    >
                      取消
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div className="grid grid-cols-2 gap-8 flex-1 text-xs">
                    <div>
                      <span className="text-[11px] text-[#9ca6b5] block">auth_token</span>
                      <span className="font-mono text-[#111827] dark:text-[#e5e8eb] font-medium">
                        {creds?.hasAuthToken ? "•••••••••••••••• (已保存)" : "未设置"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-[#9ca6b5] block">ct0 (CSRF Token)</span>
                      <span className="font-mono text-[#111827] dark:text-[#e5e8eb] font-medium">
                        {creds?.hasCt0 ? "•••••••••••••••• (已保存)" : "未设置"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={handleTest}
                      className="h-8 px-3 text-xs border-[#e6e9ec] dark:border-[#30363d]"
                    >
                      测试连接
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingCreds(true)}
                      className="h-8 px-2.5 text-xs text-[#1e5bbf]"
                    >
                      更新凭证
                    </Button>
                    {creds && (creds.hasAuthToken || creds.hasCt0) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={handleClearCreds}
                        className="h-8 px-2.5 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      >
                        清除凭证
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Sync Controls */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                size="sm"
                disabled={busy || job?.status === "running"}
                onClick={() => handleStartSync(false)}
                className="h-[36px] px-4 text-[12px] font-bold bg-[#182233] text-white hover:bg-[#253247]"
              >
                {job?.status === "running" ? (
                  <>
                    <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                    正在同步中…
                  </>
                ) : (
                  "▶ 开始增量同步"
                )}
              </Button>

              <Button
                size="sm"
                variant="outline"
                disabled={busy || job?.status === "running"}
                onClick={() => handleStartSync(true)}
                className="h-[36px] px-3.5 text-[12px] border-[#e6e9ec] dark:border-[#30363d]"
              >
                全量重新扫描 (force)
              </Button>

              {job?.status === "running" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={handleCancelSync}
                  className="h-[36px] px-3.5 text-[12px] text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-900"
                >
                  取消任务
                </Button>
              )}
            </div>

            {/* Sync Job Status & Stats */}
            {job && (
              <div className="bg-[#f9fafb] dark:bg-[#14161c] border border-[#eff1f3] dark:border-[#2b313a] rounded-[6px] p-3 text-[12px] space-y-1">
                <div className="flex items-center justify-between text-[#708094]">
                  <span>
                    状态:{" "}
                    {job.status === "running"
                      ? "正在运行"
                      : job.status === "completed"
                        ? "已完成"
                        : job.status === "failed"
                          ? "执行失败"
                          : "已取消"}
                  </span>
                  {job.updatedAt && (
                    <span>更新时间: {new Date(job.updatedAt).toLocaleString()}</span>
                  )}
                </div>
                <div className="font-sans text-[12px] text-[#111827] dark:text-[#e5e8eb] font-medium pt-1">
                  扫描: {job.scanned ?? 0} 条 | 新增导入: {job.imported ?? 0} 条 | 已认领:{" "}
                  {job.claimed ?? 0} 条 | 已跳过重复: {job.skipped ?? 0} 条
                </div>
                {job.error && <p className="text-rose-600 text-[11px] pt-1">{job.error}</p>}
              </div>
            )}

            {/* Risk Note (Figma 96:414) */}
            <div className="bg-[#fffbeb] dark:bg-[#2d2212] border border-[#fde68a] dark:border-[#785412] rounded-[6px] p-3 text-[11px] text-[#92400e] dark:text-[#fde047] space-y-1 leading-relaxed">
              <div className="font-bold flex items-center gap-1">
                <span>⚠️</span> 风控提示 (X_RISK_NOTE)
              </div>
              <p>
                {riskNote ||
                  "使用非官方 Cookie（auth_token / ct0）访问 X。存在风控与封号残留风险，接口可能随时失效。仅限个人自用，风险自担。导入与取消收藏均已内置严格请求限速。"}
              </p>
            </div>
          </div>

          {/* Coming Soon Platforms (Figma 96:417) */}
          <div className="space-y-3">
            <h3 className="text-[13px] font-bold text-[#111827] dark:text-white">
              计划中接入平台 (Coming Soon Registry)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-[#fafafc] dark:bg-[#181c24] border border-[#eff1f3] dark:border-[#2b313a] rounded-[8px] p-4 flex flex-col justify-between h-[136px]">
                <div>
                  <div className="font-bold text-[14px] text-[#111827] dark:text-white">小红书</div>
                  <span className="inline-block mt-1 bg-[#f2f4f6] dark:bg-[#21262d] text-[#9ca6b5] text-[10px] px-1.5 py-0.5 rounded">
                    敬请期待
                  </span>
                  <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5] mt-2">
                    收藏夹与笔记同步
                  </p>
                </div>
                <span className="text-[10px] font-mono text-[#9ca6b5]">Source: xiaohongshu_favorite</span>
              </div>

              <div className="bg-[#fafafc] dark:bg-[#181c24] border border-[#eff1f3] dark:border-[#2b313a] rounded-[8px] p-4 flex flex-col justify-between h-[136px]">
                <div>
                  <div className="font-bold text-[14px] text-[#111827] dark:text-white">哔哩哔哩</div>
                  <span className="inline-block mt-1 bg-[#f2f4f6] dark:bg-[#21262d] text-[#9ca6b5] text-[10px] px-1.5 py-0.5 rounded">
                    敬请期待
                  </span>
                  <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5] mt-2">
                    稍后再看与收藏视频
                  </p>
                </div>
                <span className="text-[10px] font-mono text-[#9ca6b5]">Source: bilibili_favorite</span>
              </div>

              <div className="bg-[#fafafc] dark:bg-[#181c24] border border-[#eff1f3] dark:border-[#2b313a] rounded-[8px] p-4 flex flex-col justify-between h-[136px]">
                <div>
                  <div className="font-bold text-[14px] text-[#111827] dark:text-white">YouTube</div>
                  <span className="inline-block mt-1 bg-[#f2f4f6] dark:bg-[#21262d] text-[#9ca6b5] text-[10px] px-1.5 py-0.5 rounded">
                    敬请期待
                  </span>
                  <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5] mt-2">
                    稍后观看与播放列表
                  </p>
                </div>
                <span className="text-[10px] font-mono text-[#9ca6b5]">Source: youtube_playlist</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer (Figma 96:436) */}
        <div className="h-[60px] px-7 border-t border-[#eff1f3] dark:border-[#23262f] bg-[#f2f4f6] dark:bg-[#1a1d24] flex items-center justify-end shrink-0">
          <Button
            type="button"
            size="sm"
            onClick={onClose}
            className="h-[36px] px-5 text-[12px] font-bold bg-[#182233] dark:bg-white text-white dark:text-[#182233] hover:bg-[#253247]"
          >
            完成并关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
