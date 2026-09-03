import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ImportJob, PlatformImportPublic, XCredentialsPublic } from "@shannian/shared";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

export default function ImportPage() {
  const navigate = useNavigate();
  const [inbox, setInbox] = useState(0);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [platforms, setPlatforms] = useState<PlatformImportPublic[]>([]);
  const [riskNote, setRiskNote] = useState("");
  const [creds, setCreds] = useState<XCredentialsPublic | null>(null);
  const [authToken, setAuthToken] = useState("");
  const [ct0, setCt0] = useState("");
  const [job, setJob] = useState<ImportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const [plats, x, count, cats, currentJob] = await Promise.all([
      api.importPlatforms(),
      api.xCredentials(),
      api.inboxCount(),
      api.categories(),
      api.xImportJob(),
    ]);
    if (!mountedRef.current) return;
    setPlatforms(plats.items);
    setRiskNote(plats.riskNote || x.riskNote);
    setCreds(x.credentials);
    setInbox(count.count);
    setCategories(cats.items);
    setJob(currentJob.job);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load().catch((e) => toast.error(String(e)));
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // Poll while the job is running, scheduling only after the previous request
  // settles so a slow NAS/network cannot create overlapping requests.
  useEffect(() => {
    if (job?.status !== "running") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await api.xImportJob();
        if (!cancelled && mountedRef.current) setJob(result.job);
      } catch {
        // Keep polling transient failures while the page remains open.
      } finally {
        if (!cancelled) timer = setTimeout(poll, 1500);
      }
    };
    timer = setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [job?.status]);

  async function saveCreds() {
    setBusy(true);
    try {
      const res = await api.saveXCredentials({
        authToken: authToken || undefined,
        ct0: ct0 || undefined,
      });
      setCreds(res.credentials);
      setAuthToken("");
      setCt0("");
      toast.success("凭证已保存");
      await load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clearCreds() {
    if (!confirm("清除 X 凭证？之后导入与取消收藏将不可用。")) return;
    setBusy(true);
    try {
      await api.clearXCredentials();
      toast.success("已清除");
      await load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function testConn() {
    setBusy(true);
    try {
      const r = await api.testX();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function startImport(forceFull: boolean) {
    setBusy(true);
    try {
      const r = await api.startXImport(forceFull);
      setJob(r.job);
      toast.success(forceFull ? "已开始强制全量导入" : "已开始导入");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancelImport() {
    try {
      const r = await api.cancelXImport();
      setJob(r.job);
      toast.message("已请求取消");
    } catch (e) {
      toast.error(String(e));
    }
  }

  const xPlatform = platforms.find((p) => p.id === "x");
  const running = job?.status === "running";
  const connected = Boolean(creds?.hasAuthToken && creds?.hasCt0);

  return (
    <AppShell
      inboxCount={inbox}
      categories={categories}
      onFilterChange={() => navigate("/")}
    >
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6 lg:px-8">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">导入</h1>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            从各平台收藏夹手动导入。链接可在首页输入框粘贴。
          </p>
        </div>

        {riskNote && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:text-amber-100">
            {riskNote}
          </div>
        )}

        {/* X card */}
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">
                {xPlatform?.label || "X"}
              </h2>
              <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                Bookmarks 书签 · 永久删除时尽力取消原平台收藏
              </p>
              <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">
                状态：
                {creds?.hasAuthToken && creds?.hasCt0 ? (
                  <span className="text-emerald-600 dark:text-emerald-400"> 已配置凭证</span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-300"> 未连接</span>
                )}
                {creds?.authTokenHint && (
                  <span className="ml-2 opacity-70">token {creds.authTokenHint}</span>
                )}
              </p>
            </div>
            <Download className="size-5 text-[var(--color-muted-foreground)]" aria-hidden />
          </div>

          <div className="mt-4 space-y-2">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={
                creds?.authTokenHint
                  ? `auth_token（已配置 ${creds.authTokenHint}，留空不改）`
                  : "auth_token"
              }
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
            />
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={
                creds?.ct0Hint ? `ct0（已配置 ${creds.ct0Hint}，留空不改）` : "ct0（CSRF）"
              }
              value={ct0}
              onChange={(e) => setCt0(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy || (!authToken && !ct0)} onClick={saveCreds}>
                保存凭证
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={testConn}>
                测试连接
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={clearCreds}>
                清除凭证
              </Button>
            </div>
          </div>

          <div className="mt-5 border-t border-[var(--color-border)] pt-4">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy || running || !connected}
                onClick={() => startImport(false)}
              >
                {running ? (
                  <>
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                    导入中…
                  </>
                ) : (
                  "导入 Bookmarks"
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || running || !connected}
                onClick={() => {
                  if (!confirm("强制全量将重新扫描全部书签（已存在的会跳过/认领）。继续？")) return;
                  startImport(true);
                }}
              >
                强制全量
              </Button>
              {running && (
                <Button size="sm" variant="ghost" onClick={cancelImport}>
                  取消
                </Button>
              )}
            </div>

            {job && (
              <div className="mt-3 rounded-lg bg-[var(--color-muted)]/50 px-3 py-2 text-xs">
                <div className="font-medium">
                  任务{" "}
                  <span className="tabular-nums opacity-70">{job.status}</span>
                  {job.forceFull && (
                    <span className="ml-2 rounded bg-black/10 px-1 dark:bg-white/10">全量</span>
                  )}
                </div>
                <div className="mt-1 text-[var(--color-muted-foreground)]">
                  扫描 {job.scanned} · 新建 {job.imported} · 认领 {job.claimed} · 跳过 {job.skipped}
                </div>
                {job.message && <div className="mt-1">{job.message}</div>}
                {job.error && (
                  <div className="mt-1 text-red-600 dark:text-red-400">{job.error}</div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Coming soon */}
        {platforms
          .filter((p) => p.comingSoon || !p.available)
          .map((p) => (
            <section
              key={p.id}
              className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-card)]/50 p-5 opacity-70"
            >
              <h2 className="text-sm font-semibold tracking-tight">{p.label}</h2>
              <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">即将支持</p>
            </section>
          ))}
      </div>
    </AppShell>
  );
}
