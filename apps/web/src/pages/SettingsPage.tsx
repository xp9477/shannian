import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {desc && <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{desc}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [inbox, setInbox] = useState(0);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [settings, cats, count] = await Promise.all([
        api.settings(),
        api.categories(),
        api.inboxCount(),
      ]);
      if (cancelled) return;
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
      setInbox(count.count);
    })().catch((e) => {
      if (!cancelled) toast.error(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell
      inboxCount={inbox}
      categories={categories}
      onFilterChange={() => navigate("/")}
    >
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6 lg:px-8">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">设置</h1>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            AI、存储与分类词表。密钥仅保存在你的 NAS。
          </p>
        </div>

        <Section
          title="HTTP 代理"
          desc="用于 X、AI 等受信目标。公开网页/缩略图为防 SSRF 会直连并固定已校验 IP，不经此代理。"
        >
          <Input
            placeholder={
              proxyMeta?.hasCredentials
                ? "已保存含凭证的代理；输入新地址才会替换"
                : "http://127.0.0.1:7890  或  http://user:pass@host:port"
            }
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
          />
          {proxyMeta && (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {proxyMeta.hasProxy
                ? `当前生效：${proxyMeta.effectiveUrl || "—"}（来源：${
                    proxyMeta.source === "settings"
                      ? "设置"
                      : proxyMeta.source === "env"
                        ? "环境变量"
                        : "无"
                  }）`
                : "当前直连（未配置代理）"}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!proxyUrl.trim() && Boolean(proxyMeta?.hasProxy)}
              onClick={async () => {
                try {
                  const r = await api.saveProxy(proxyUrl.trim());
                  setProxyUrl(r.proxy.proxyUrl);
                  setProxyMeta({
                    source: r.proxy.source,
                    effectiveUrl: r.proxy.effectiveUrl,
                    hasProxy: r.proxy.hasProxy,
                    hasCredentials: r.proxy.hasCredentials,
                  });
                  toast.success(r.proxy.hasProxy ? "代理已保存" : "已清除设置中的代理");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              保存
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const r = await api.testProxy();
                  r.ok ? toast.success(r.message) : toast.error(r.message);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "代理测试失败");
                }
              }}
            >
              测试代理
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  const r = await api.saveProxy("");
                  setProxyUrl("");
                  setProxyMeta({
                    source: r.proxy.source,
                    effectiveUrl: r.proxy.effectiveUrl,
                    hasProxy: r.proxy.hasProxy,
                    hasCredentials: r.proxy.hasCredentials,
                  });
                  toast.success("已清除设置代理（仍可读环境变量）");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "清除代理失败");
                }
              }}
            >
              清除
            </Button>
          </div>
        </Section>

        <Section title="AI（OpenAI 兼容）" desc="用于分类与摘要">
          <Input
            placeholder="Base URL"
            value={ai.baseUrl}
            onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
          />
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={aiHint ? `API Key（已配置 ${aiHint}，留空不改）` : "API Key"}
            value={ai.apiKey}
            onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
          />
          <Input
            placeholder="Model"
            value={ai.model}
            onChange={(e) => setAi({ ...ai, model: e.target.value })}
          />
          <div className="flex gap-2">
            <Button
              onClick={async () => {
                try {
                  const saved = await api.saveAi({
                    baseUrl: ai.baseUrl,
                    model: ai.model,
                    apiKey: ai.apiKey || undefined,
                  });
                  setAi({
                    baseUrl: saved.ai.baseUrl,
                    model: saved.ai.model,
                    apiKey: "",
                  });
                  setAiHint(saved.ai.keyHint);
                  toast.success("AI 已保存");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "AI 保存失败");
                }
              }}
            >
              保存
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const r = await api.testAi();
                  r.ok ? toast.success(r.message) : toast.error(r.message);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "AI 连接测试失败");
                }
              }}
            >
              测试连接
            </Button>
          </div>
        </Section>

        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <details className="group">
            <summary className="cursor-pointer list-none text-sm font-semibold tracking-tight marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between gap-2">
                MinIO / Obsidian（高级 · 可选）
                <span className="text-xs font-normal text-[var(--color-muted-foreground)] group-open:hidden">
                  展开
                </span>
              </span>
            </summary>
            <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
              日常分流不需要。封面已存本地 data/thumbs/；此处仅当你要把笔记导出到 S3 兼容存储时再配。
            </p>
            <div className="mt-4 space-y-3">
              <Input
                placeholder="Endpoint"
                value={minio.endpoint}
                onChange={(e) => setMinio({ ...minio, endpoint: e.target.value })}
              />
              <Input
                placeholder="Bucket"
                value={minio.bucket}
                onChange={(e) => setMinio({ ...minio, bucket: e.target.value })}
              />
              <Input
                placeholder={minioHint ? `Access Key（已配置 ${minioHint}，留空不改）` : "Access Key"}
                value={minio.accessKey}
                onChange={(e) => setMinio({ ...minio, accessKey: e.target.value })}
              />
              <Input
                type="password"
                placeholder="Secret Key（留空不改）"
                value={minio.secretKey}
                onChange={(e) => setMinio({ ...minio, secretKey: e.target.value })}
              />
              <Input
                placeholder="Vault 前缀"
                value={minio.vaultPrefix}
                onChange={(e) => setMinio({ ...minio, vaultPrefix: e.target.value })}
              />
              <div className="flex gap-2">
                <Button
                  onClick={async () => {
                    try {
                      const saved = await api.saveMinio({
                        endpoint: minio.endpoint,
                        bucket: minio.bucket,
                        accessKey: minio.accessKey || undefined,
                        secretKey: minio.secretKey || undefined,
                        region: minio.region,
                        thumbsPrefix: minio.thumbsPrefix,
                        vaultPrefix: minio.vaultPrefix,
                      });
                      setMinio({
                        endpoint: saved.minio.endpoint,
                        bucket: saved.minio.bucket,
                        accessKey: "",
                        secretKey: "",
                        region: saved.minio.region,
                        thumbsPrefix: saved.minio.thumbsPrefix,
                        vaultPrefix: saved.minio.vaultPrefix,
                      });
                      setMinioHint(saved.minio.accessKeyHint);
                      toast.success("MinIO 已保存");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "MinIO 保存失败");
                    }
                  }}
                >
                  保存
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const r = await api.testMinio();
                      r.ok ? toast.success(r.message) : toast.error(r.message);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "MinIO 连接测试失败");
                    }
                  }}
                >
                  测试连接
                </Button>
              </div>
            </div>
          </details>
        </section>

        <Section title="分类词表">
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs"
              >
                {c.name}
                <button
                  className="text-[var(--color-destructive)]"
                  onClick={async () => {
                    if (!confirm(`删除分类「${c.name}」？相关卡片将变为未分类。`)) return;
                    try {
                      await api.deleteCategory(c.id);
                      setCategories((xs) => xs.filter((x) => x.id !== c.id));
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "删除分类失败");
                    }
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="新分类" />
            <Button
              onClick={async () => {
                if (!newCat.trim()) return;
                try {
                  await api.createCategory(newCat.trim());
                  setNewCat("");
                  setCategories((await api.categories()).items);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "添加分类失败");
                }
              }}
            >
              添加
            </Button>
          </div>
        </Section>

        <Section
          title="数据与备份"
          desc="JSON 只是活动卡片的逻辑副本；完整恢复需复制整个 data、Obsidian 对象和外部加密密钥。"
        >
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/50 px-3 py-2.5 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
            <p className="font-medium text-[var(--color-foreground)]">建议定期备份</p>
            <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
              <li>下方导出活动卡片 JSON（不能直接恢复）</li>
              <li>停服务后复制整个 data 目录（数据库 + thumbs）</li>
              <li>如启用 MinIO：备份 vault-export 前缀；另存设置加密密钥</li>
            </ol>
          </div>
          <Button
            variant="outline"
            className="min-h-10 w-full sm:w-auto"
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
                toast.success("已导出 JSON");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "导出 JSON 失败");
              }
            }}
          >
            导出活动卡片 JSON
          </Button>
        </Section>

        <Section title="账号">
          <Input
            type="password"
            placeholder="当前密码"
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
          />
          <Input
            type="password"
            placeholder="新密码（至少 8 位）"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
          />
          <div className="flex gap-2">
            <Button
              onClick={async () => {
                try {
                  await api.changePassword(pw.current, pw.next);
                  setPw({ current: "", next: "" });
                  toast.success("密码已修改");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "失败");
                }
              }}
            >
              修改密码
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await api.logout();
                  navigate(0);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "登出失败");
                }
              }}
            >
              登出
            </Button>
          </div>
        </Section>

        <Separator />
        <p className="pb-8 text-center text-[11px] text-[var(--color-muted-foreground)]">
          闪念 · 个人灵感库
        </p>
      </div>
    </AppShell>
  );
}
