import { useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

export default function LoginPage({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.login(password);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-background)] px-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 top-1/4 size-72 rounded-full bg-[var(--color-primary)]/8 blur-3xl" />
        <div className="absolute -right-16 bottom-1/4 size-64 rounded-full bg-indigo-300/15 blur-3xl" />
      </div>
      <form
        onSubmit={submit}
        className="surface-elevated relative w-full max-w-[22rem] rounded-3xl p-8"
      >
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-3.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--color-primary)] text-sm font-bold text-[var(--color-primary-foreground)] shadow-md shadow-[color-mix(in_oklab,var(--color-primary)_30%,transparent)]">
            闪
          </div>
          <div className="text-[1.35rem] font-semibold tracking-tight">闪念</div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">
            跨平台灵感收件箱
            <br />
            扫一眼摘要，留下有用的
          </p>
        </div>
        <label className="mb-1.5 block text-[11.5px] font-medium text-[var(--color-muted-foreground)]">
          密码
        </label>
        <Input
          type="password"
          autoComplete="current-password"
          spellCheck={false}
          autoFocus
          className="h-10 rounded-xl"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="输入主人密码"
        />
        <Button
          type="submit"
          className="mt-5 h-10 w-full rounded-xl text-[14px]"
          disabled={loading || !password}
        >
          {loading ? "进入中…" : "进入"}
        </Button>
      </form>
    </div>
  );
}
