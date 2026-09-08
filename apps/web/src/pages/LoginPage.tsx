import React, { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogoMark } from "@/components/Logo";

export default function LoginPage({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    try {
      await api.login(password);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "登录失败，请检查密码");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-[#f9fafb] dark:bg-[#0d1117] px-4 select-none">
      <form
        onSubmit={submit}
        className="bg-white dark:bg-[#14161c] border border-[#e6e9ec] dark:border-[#23262f] rounded-[12px] p-8 max-w-[400px] w-full shadow-lg relative space-y-5"
      >
        {/* Daily Login Badge (Figma 103:587) */}
        <div className="flex items-center justify-between">
          <span className="bg-[#f2f4f6] dark:bg-[#21262d] text-[#6b7686] dark:text-[#9ca6b5] text-[11px] font-bold px-2.5 py-0.5 rounded-[4px]">
            日常登录
          </span>
        </div>

        <div>
          <h1 className="text-[18px] font-bold text-[#111827] dark:text-white">
            解锁闪念工作台
          </h1>
          <p className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5] mt-1">
            请输入主人密码。会话保持 30 天有效。
          </p>
        </div>

        {/* Runtime Brand Hero Box (Figma 103:591) */}
        <div className="bg-[#f2f4f6] dark:bg-[#1a1d24] rounded-[8px] p-5 flex flex-col items-center justify-center gap-2 border border-[#eff1f3] dark:border-[#2b313a]">
          <div className="size-10 rounded-full bg-[#182233] dark:bg-white text-white dark:text-[#182233] flex items-center justify-center shadow-sm">
            <LogoMark size={20} />
          </div>
          <span className="font-serif font-bold text-[14px] text-[#111827] dark:text-white">
            闪念
          </span>
          <span className="font-sans font-semibold text-[10px] text-[#9ca6b5] tracking-[0.6px]">
            SHANNIAN LOCAL RUNTIME
          </span>
        </div>

        <div className="space-y-1.5">
          <label className="block text-[11px] font-medium text-[#111827] dark:text-[#e5e8eb]">
            主人密码 (Master Password)
          </label>
          <Input
            type="password"
            autoComplete="current-password"
            spellCheck={false}
            autoFocus
            className="h-[38px] text-[13px] bg-[#f2f4f6] dark:bg-[#1a1d24] border-[#e6e9ec] dark:border-[#2b313a]"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="输入主人密码"
          />
        </div>

        {/* Remember me checkbox (Figma 103:598) */}
        <label className="flex items-center gap-2 cursor-pointer text-[12px] text-[#6b7686] dark:text-[#9ca6b5]">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="size-4 rounded border-[#d1d5db] dark:border-[#4b5563] text-[#182233] focus:ring-[#1e5bbf]"
          />
          <span>保持当前浏览器登录 30 天</span>
        </label>

        <Button
          type="submit"
          disabled={loading || !password.trim()}
          className="w-full h-[42px] font-bold text-[13px] bg-[#182233] dark:bg-white text-white dark:text-[#182233] hover:bg-[#253247] shadow-sm rounded-[6px]"
        >
          {loading ? "验证中…" : "进入工作台 (Enter)"}
        </Button>
      </form>
    </div>
  );
}
