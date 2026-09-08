import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onCategoriesUpdated?: () => void;
}

type SectionKey = "proxy" | "ai" | "minio" | "categories" | "backup" | "password";

export function SettingsModal({ open, onClose, onCategoriesUpdated }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SectionKey>("minio");
  const [ai, setAi] = useState({ baseUrl: "", apiKey: "", model: "" });
  const [minio, setMinio] = useState({
    endpoint: "",
    bucket: "",
    accessKey: "",
    secretKey: "",
    region: "us-east-1",
    thumbsPrefix: "thumbs/",
    vaultPrefix: "vault-export/",
  });
  const [aiHint, setAiHint] = useState<string | null>(null);
  const [minioHint, setMinioHint] = useState<string | null>(null);
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyMeta, setProxyMeta] = useState<{
    source: string;
    effectiveUrl: string | null;
    hasProxy: boolean;
    hasCredentials: boolean;
  } | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [newCat, setNewCat] = useState("");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [busy, setBusy] = useState(false);

  const loadSettings = async () => {
    try {
      const [settings, cats] = await Promise.all([api.settings(), api.categories()]);
      setAi({ baseUrl: settings.ai.baseUrl, apiKey: "", model: settings.ai.model });
      setAiHint(settings.ai.keyHint);
      setMinio({
        endpoint: settings.minio.endpoint,
        bucket: settings.minio.bucket,
        accessKey: "",
        secretKey: "",
        region: settings.minio.region,
        thumbsPrefix: settings.minio.thumbsPrefix,
        vaultPrefix: settings.minio.vaultPrefix,
      });
      setMinioHint(settings.minio.accessKeyHint);
      setProxyUrl(settings.proxy?.proxyUrl || "");
      setProxyMeta(
        settings.proxy
          ? {
              source: settings.proxy.source,
              effectiveUrl: settings.proxy.effectiveUrl,
              hasProxy: settings.proxy.hasProxy,
              hasCredentials: settings.proxy.hasCredentials,
            }
          : null
      );
      setCategories(cats.items);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载配置失败");
    }
  };

  useEffect(() => {
    if (open) {
      loadSettings();
    }
  }, [open]);

  // Handle Esc
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px] animate-in fade-in duration-150 select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div className="bg-white dark:bg-[#14161c] border border-[#e6e9ec] dark:border-[#23262f] rounded-[12px] shadow-2xl max-w-[840px] w-full h-[720px] max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col">
        {/* Header (Figma 100:4) */}
        <div className="h-[64px] px-6 border-b border-[#eff1f3] dark:border-[#23262f] flex items-center justify-between shrink-0">
          <div>
            <h2 id="settings-title" className="text-[17px] font-bold text-[#111827] dark:text-white leading-none">
              设置
            </h2>
            <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5] mt-1.5 leading-none">
              AI、存储、代理与分类词表。密钥仅保存在你的本地宿主机。
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

        {/* Content Area: Left Sidebar (180px) + Right Section */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Navigation (Figma 100:9) */}
          <div className="w-[180px] shrink-0 bg-[#f2f4f6] dark:bg-[#1a1d24] border-r border-[#eff1f3] dark:border-[#23262f] p-2 space-y-1">
            <button
              type="button"
              onClick={() => setActiveSection("proxy")}
              className={cn(
                "w-full text-left px-3 py-2 rounded-[6px] text-[12px] transition-colors",
                activeSection === "proxy"
                  ? "bg-white dark:bg-[#242b38] text-[#111827] dark:text-white font-bold shadow-2xs border border-[#e6e9ec] dark:border-[#374151]"
                  : "text-[#6b7686] dark:text-[#9ca6b5] hover:bg-white/50"
              )}
            >
              HTTP 代理
            </button>

            <button
              type="button"
              onClick={() => setActiveSection("ai")}
              className={cn(
                "w-full text-left px-3 py-2 rounded-[6px] text-[12px] transition-colors",
                activeSection === "ai"
                  ? "bg-white dark:bg-[#242b38] text-[#111827] dark:text-white font-bold shadow-2xs border border-[#e6e9ec] dark:border-[#374151]"
                  : "text-[#6b7686] dark:text-[#9ca6b5] hover:bg-white/50"
              )}
            >
              AI（OpenAI 兼容）
            </button>

            <button
              type="button"
              onClick={() => setActiveSection("minio")}
              className={cn(
                "w-full text-left px-3 py-2 rounded-[6px] text-[12px] transition-colors flex items-center justify-between",
                activeSection === "minio"
                  ? "bg-white dark:bg-[#242b38] text-[#111827] dark:text-white font-bold shadow-2xs border border-[#e6e9ec] dark:border-[#374151]"
                  : "text-[#6b7686] dark:text-[#9ca6b5] hover:bg-white/50"
              )}
            >
              <span>MinIO / Obsidian</span>
              <span className="bg-[#f2f4f6] dark:bg-[#1a1d24] text-[#9ca6b5] text-[9px] px-1 py-0.5 rounded">
                可选
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSection("categories")}
              className={cn(
                "w-full text-left px-3 py-2 rounded-[6px] text-[12px] transition-colors",
                activeSection === "categories"
                  ? "bg-white dark:bg-[#242b38] text-[#111827] dark:text-white font-bold shadow-2xs border border-[#e6e9ec] dark:border-[#374151]"
                  : "text-[#6b7686] dark:text-[#9ca6b5] hover:bg-white/50"
              )}
            >
              分类词表
            </button>

            <button
              type="button"
              onClick={() => setActiveSection("backup")}
              className={cn(
                "w-full text-left px-3 py-2 rounded-[6px] text-[12px] transition-colors",
                activeSection === "backup"
                  ? "bg-white dark:bg-[#242b38] text-[#111827] dark:text-white font-bold shadow-2xs border border-[#e6e9ec] dark:border-[#374151]"
                  : "text-[#6b7686] dark:text-[#9ca6b5] hover:bg-white/50"
              )}
            >
              数据与备份
            </button>

            <button
              type="button"
              onClick={() => setActiveSection("password")}
              className={cn(
                "w-full text-left px-3 py-2 rounded-[6px] text-[12px] transition-colors",
                activeSection === "password"
                  ? "bg-white dark:bg-[#242b38] text-[#111827] dark:text-white font-bold shadow-2xs border border-[#e6e9ec] dark:border-[#374151]"
                  : "text-[#6b7686] dark:text-[#9ca6b5] hover:bg-white/50"
              )}
            >
              主密码与安全
            </button>
          </div>

          {/* Right Section Content */}
          <div className="flex-1 overflow-y-auto scroll-thin p-7">
            {/* 1. HTTP Proxy Section */}
            {activeSection === "proxy" && (
              <div className="space-y-4 max-w-[580px]">
                <div>
                  <h3 className="text-[15px] font-bold text-[#111827] dark:text-white">
                    HTTP 代理设置
                  </h3>
                  <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5] mt-1">
                    用于抓取外网网页正文与 X 推文数据。支持 http / socks5 代理协议。
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                    代理服务器 URL (Proxy URL)
                  </label>
                  <Input
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    placeholder="例如: http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
                    className="h-[36px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
                  />
                  {proxyMeta && (
                    <p className="text-[11px] text-[#9ca6b5] mt-1">
                      来源: {proxyMeta.source} · 当前生效: {proxyMeta.effectiveUrl || "未启用"}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api.saveProxy(proxyUrl.trim());
                        toast.success("代理设置已保存");
                        await loadSettings();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "保存代理失败");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="h-[36px] px-4 text-[12px] font-bold bg-[#182233] text-white hover:bg-[#253247]"
                  >
                    保存
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const res = await api.testProxy();
                        if (res.ok) toast.success(res.message || "代理测试成功");
                        else toast.error(res.message || "代理测试失败");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "代理测试失败");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="h-[36px] px-4 text-[12px] border-[#e6e9ec] dark:border-[#30363d]"
                  >
                    测试连接
                  </Button>
                </div>
              </div>
            )}

            {/* 2. AI Section */}
            {activeSection === "ai" && (
              <div className="space-y-4 max-w-[580px]">
                <div>
                  <h3 className="text-[15px] font-bold text-[#111827] dark:text-white">
                    AI 设置（OpenAI 兼容接口）
                  </h3>
                  <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5] mt-1">
                    用于卡片自动生成标题、智能分类及提取长文核心摘要。
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                    Base URL
                  </label>
                  <Input
                    value={ai.baseUrl}
                    onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                    className="h-[36px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                    API Key
                  </label>
                  <Input
                    type="password"
                    value={ai.apiKey}
                    onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
                    placeholder={aiHint ? `${aiHint} (留空不改)` : "sk-..."}
                    className="h-[36px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                    Model
                  </label>
                  <Input
                    value={ai.model}
                    onChange={(e) => setAi({ ...ai, model: e.target.value })}
                    placeholder="gpt-4o-mini"
                    className="h-[36px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api.saveAi({
                          baseUrl: ai.baseUrl.trim(),
                          apiKey: ai.apiKey.trim() || undefined,
                          model: ai.model.trim(),
                        });
                        toast.success("AI 配置已保存");
                        await loadSettings();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "保存失败");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="h-[36px] px-4 text-[12px] font-bold bg-[#182233] text-white hover:bg-[#253247]"
                  >
                    保存
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const res = await api.testAi();
                        if (res.ok) toast.success(res.message || "AI 测试成功");
                        else toast.error(res.message || "AI 测试失败");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "AI 测试失败");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="h-[36px] px-4 text-[12px] border-[#e6e9ec] dark:border-[#30363d]"
                  >
                    测试连接
                  </Button>
                </div>
              </div>
            )}

            {/* 3. MinIO / Obsidian Section (Figma 100:24) */}
            {activeSection === "minio" && (
              <div className="space-y-4 max-w-[580px]">
                <div>
                  <h3 className="text-[15px] font-bold text-[#111827] dark:text-white">
                    MinIO / Obsidian（高级 · 可选）
                  </h3>
                  <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5] mt-1">
                    日常分流不需要。封面已存本地 data/thumbs/；此处仅当你要把笔记导出到 S3 兼容存储时再配。
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                      Endpoint
                    </label>
                    <Input
                      value={minio.endpoint}
                      onChange={(e) => setMinio({ ...minio, endpoint: e.target.value })}
                      placeholder="http://127.0.0.1:9000"
                      className="h-[36px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                      Bucket
                    </label>
                    <Input
                      value={minio.bucket}
                      onChange={(e) => setMinio({ ...minio, bucket: e.target.value })}
                      placeholder="shannian-vault"
                      className="h-[36px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                      Access Key
                    </label>
                    <Input
                      value={minio.accessKey}
                      onChange={(e) => setMinio({ ...minio, accessKey: e.target.value })}
                      placeholder={minioHint || "minioadmin"}
                      className="h-[36px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                      Secret Key（留空不改）
                    </label>
                    <Input
                      type="password"
                      value={minio.secretKey}
                      onChange={(e) => setMinio({ ...minio, secretKey: e.target.value })}
                      placeholder="留空不改"
                      className="h-[36px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                    Vault 前缀
                  </label>
                  <Input
                    value={minio.vaultPrefix}
                    onChange={(e) => setMinio({ ...minio, vaultPrefix: e.target.value })}
                    placeholder="vault-export/"
                    className="h-[36px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
                  />
                  <p className="text-[11px] text-[#9ca6b5] mt-1">
                    点击卡片底栏「导出至 Obsidian」时，导出的 Markdown 笔记将存入此路径前缀下。
                  </p>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api.saveMinio({
                          endpoint: minio.endpoint.trim(),
                          bucket: minio.bucket.trim(),
                          accessKey: minio.accessKey.trim() || undefined,
                          secretKey: minio.secretKey.trim() || undefined,
                          region: minio.region || "us-east-1",
                          thumbsPrefix: minio.thumbsPrefix,
                          vaultPrefix: minio.vaultPrefix,
                        });
                        toast.success("MinIO 配置已保存");
                        await loadSettings();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "保存失败");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="h-[36px] px-4 text-[12px] font-bold bg-[#182233] text-white hover:bg-[#253247]"
                  >
                    保存
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const res = await api.testMinio();
                        if (res.ok) toast.success(res.message || "存储连接测试成功");
                        else toast.error(res.message || "连接测试失败");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "连接测试失败");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="h-[36px] px-4 text-[12px] border-[#e6e9ec] dark:border-[#30363d]"
                  >
                    测试连接
                  </Button>
                </div>

                <div className="h-px bg-[#eff1f3] dark:bg-[#23262f] my-4" />

                {/* Quick categories chips (Figma 100:48) */}
                <div>
                  <p className="text-[12px] font-bold text-[#9ca6b5] mb-2">
                    当前分类词表 (快捷查看)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {categories.map((c) => (
                      <span
                        key={c.id}
                        className="bg-[#f2f4f6] dark:bg-[#21262d] border border-[#eff1f3] dark:border-[#2b313a] rounded-[4px] px-2.5 py-1 text-[11px] text-[#6b7686] dark:text-[#9ca6b5]"
                      >
                        {c.name}
                      </span>
                    ))}
                    {categories.length === 0 && (
                      <span className="text-xs text-[#9ca6b5]">暂无分类</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 4. Categories Section */}
            {activeSection === "categories" && (
              <div className="space-y-4 max-w-[580px]">
                <div>
                  <h3 className="text-[15px] font-bold text-[#111827] dark:text-white">
                    分类词表管理
                  </h3>
                  <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5] mt-1">
                    定义闪念的知识分类。AI 摘要将依据此词表自动为卡片归类。
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  {categories.map((c) => (
                    <span
                      key={c.id}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#f2f4f6] dark:bg-[#21262d] border border-[#e6e9ec] dark:border-[#2b313a] px-3 py-1.5 text-xs text-[#111827] dark:text-[#e5e8eb]"
                    >
                      <span>{c.name}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm(`确认删除分类「${c.name}」？关联卡片将变为未分类。`)) return;
                          try {
                            await api.deleteCategory(c.id);
                            setCategories((prev) => prev.filter((item) => item.id !== c.id));
                            onCategoriesUpdated?.();
                            toast.success("分类已删除");
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "删除失败");
                          }
                        }}
                        className="text-[#9ca6b5] hover:text-rose-600 font-bold ml-1 cursor-pointer"
                        title="删除分类"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {categories.length === 0 && (
                    <p className="text-xs text-[#9ca6b5]">尚未创建自定义分类</p>
                  )}
                </div>

                <div className="flex gap-2 pt-4">
                  <Input
                    value={newCat}
                    onChange={(e) => setNewCat(e.target.value)}
                    placeholder="输入新分类名称..."
                    className="h-[36px] text-[12px] max-w-[280px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (newCat.trim()) {
                          api.createCategory(newCat.trim()).then(async () => {
                            setNewCat("");
                            const updated = await api.categories();
                            setCategories(updated.items);
                            onCategoriesUpdated?.();
                            toast.success("已添加分类");
                          }).catch((err) => toast.error(String(err)));
                        }
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!newCat.trim()) return;
                      try {
                        await api.createCategory(newCat.trim());
                        setNewCat("");
                        const updated = await api.categories();
                        setCategories(updated.items);
                        onCategoriesUpdated?.();
                        toast.success("已添加分类");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "添加分类失败");
                      }
                    }}
                    className="h-[36px] px-4 text-[12px] bg-[#182233] text-white"
                  >
                    添加分类
                  </Button>
                </div>
              </div>
            )}

            {/* 5. Data & Backup Section */}
            {activeSection === "backup" && (
              <div className="space-y-4 max-w-[580px]">
                <div>
                  <h3 className="text-[15px] font-bold text-[#111827] dark:text-white">
                    数据与备份 (Data & Backup)
                  </h3>
                  <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5] mt-1">
                    JSON 导出仅包含活动卡片的逻辑结构；完整灾备请在停止服务后复制整个宿主机 data 目录。
                  </p>
                </div>

                <div className="rounded-lg border border-[#e6e9ec] dark:border-[#2b313a] bg-[#fafafc] dark:bg-[#181b22] p-4 text-xs leading-relaxed text-[#546378] dark:text-[#9ca6b5] space-y-1.5">
                  <p className="font-bold text-[#111827] dark:text-white">建议的定期备份策略：</p>
                  <ol className="list-decimal space-y-1 pl-4">
                    <li>点击下方导出活动卡片 JSON，保存最新文本快照；</li>
                    <li>停止 Docker 容器后，完整备份宿主机挂载的 data 目录（含 SQLite 数据库及本地封面图缓存）；</li>
                    <li>若配置了 MinIO / S3：同时备份对应的 vault-export/ 路径与设置加密密钥。</li>
                  </ol>
                </div>

                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const data = await api.exportAll();
                      const blob = new Blob([JSON.stringify(data, null, 2)], {
                        type: "application/json",
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `shannian-export-${new Date().toISOString().slice(0, 10)}.json`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 0);
                      toast.success("已成功导出 JSON 备份");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "导出失败");
                    }
                  }}
                  className="h-[36px] px-4 text-[12px] border-[#e6e9ec] dark:border-[#30363d]"
                >
                  导出活动卡片 JSON
                </Button>
              </div>
            )}

            {/* 6. Password & Security Section */}
            {activeSection === "password" && (
              <div className="space-y-4 max-w-[580px]">
                <div>
                  <h3 className="text-[15px] font-bold text-[#111827] dark:text-white">
                    主人密码与安全设置
                  </h3>
                  <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5] mt-1">
                    修改主人访问主密码，或主动登出当前会话。
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                      当前密码
                    </label>
                    <Input
                      type="password"
                      value={pw.current}
                      onChange={(e) => setPw({ ...pw, current: e.target.value })}
                      placeholder="输入当前主人密码"
                      className="h-[36px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb] mb-1">
                      新密码（至少 8 位）
                    </label>
                    <Input
                      type="password"
                      value={pw.next}
                      onChange={(e) => setPw({ ...pw, next: e.target.value })}
                      placeholder="设置新的安全密码"
                      className="h-[36px] text-[12px] bg-[#f2f4f6] dark:bg-[#1a1d24]"
                    />
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <Button
                      size="sm"
                      onClick={async () => {
                        if (!pw.current || !pw.next) {
                          toast.error("请完整输入当前密码和新密码");
                          return;
                        }
                        try {
                          await api.changePassword(pw.current, pw.next);
                          setPw({ current: "", next: "" });
                          toast.success("主密码修改成功");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "修改密码失败");
                        }
                      }}
                      className="h-[36px] px-4 text-[12px] font-bold bg-[#182233] text-white"
                    >
                      修改密码
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await api.logout();
                          window.location.href = "/";
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "登出失败");
                        }
                      }}
                      className="h-[36px] px-4 text-[12px] border-rose-200 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    >
                      安全登出
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer (Figma 100:61) */}
        <div className="h-[60px] px-6 border-t border-[#eff1f3] dark:border-[#23262f] bg-[#f2f4f6] dark:bg-[#1a1d24] flex items-center justify-between shrink-0">
          <span className="text-[11px] text-[#9ca6b5]">
            单用户主密码保护 · 数据完整存储于本地 SQLite 与本地目录
          </span>
          <Button
            type="button"
            size="sm"
            onClick={onClose}
            className="h-[36px] px-5 text-[12px] font-bold bg-[#182233] dark:bg-white text-white dark:text-[#182233] hover:bg-[#253247]"
          >
            完成
          </Button>
        </div>
      </div>
    </div>
  );
}
