import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Moon, Search, Sun, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { api } from "@/lib/api";
import { applyTheme, getThemeMode, setThemeMode, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

export type TopbarTab = "inbox" | "organized" | "thoughts";

interface TopbarProps {
  activeTab: TopbarTab;
  onTabChange: (tab: TopbarTab) => void;
  inboxCount?: number;
  organizedCount?: number;
  thoughtsCount?: number;
  trashCount?: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenCapture: () => void;
  onOpenImport: () => void;
  onOpenSettings: () => void;
  onOpenTrash: () => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

export function Topbar({
  activeTab,
  onTabChange,
  inboxCount = 0,
  organizedCount = 0,
  thoughtsCount = 0,
  trashCount = 0,
  searchQuery,
  onSearchChange,
  onOpenCapture,
  onOpenImport,
  onOpenSettings,
  onOpenTrash,
  searchInputRef,
}: TopbarProps) {
  const [theme, setTheme] = useState<ThemeMode>(getThemeMode());
  const [serviceHealthy, setServiceHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const res = await fetch("/api/health");
        if (!cancelled) setServiceHealthy(res.ok);
      } catch {
        if (!cancelled) setServiceHealthy(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  function cycleTheme() {
    const order: ThemeMode[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setThemeMode(next);
    setTheme(next);
    applyTheme(next);
  }

  return (
    <>
      <header className="h-[56px] w-full border-b border-[#e6e9ec] dark:border-[#23262f] bg-white dark:bg-[#14161c] px-4 sm:px-6 flex items-center justify-between shrink-0 z-30 select-none">
      {/* Left: Brand + Navigation Tabs */}
      <div className="flex items-center gap-6 lg:gap-8">
        <Link to="/" className="cursor-pointer" aria-label="返回首页">
          <Logo size={18} />
        </Link>

        {/* Desktop Tabs */}
        <nav
          className="hidden md:flex items-center gap-6 h-[56px]"
          role="navigation"
          aria-label="主导航"
        >
          <button
            type="button"
            onClick={() => onTabChange("inbox")}
            className={cn(
              "relative h-[56px] flex items-center text-[14px] transition-colors",
              activeTab === "inbox"
                ? "font-bold text-[#111827] dark:text-white"
                : "font-normal text-[#6b7686] dark:text-[#9ca6b5] hover:text-[#111827] dark:hover:text-white"
            )}
          >
            <span>收件箱 ({inboxCount})</span>
            {activeTab === "inbox" && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#182233] dark:bg-white" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onTabChange("organized")}
            className={cn(
              "relative h-[56px] flex items-center text-[14px] transition-colors",
              activeTab === "organized"
                ? "font-bold text-[#111827] dark:text-white"
                : "font-normal text-[#6b7686] dark:text-[#9ca6b5] hover:text-[#111827] dark:hover:text-white"
            )}
          >
            <span>已保留 ({organizedCount})</span>
            {activeTab === "organized" && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#182233] dark:bg-white" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onTabChange("thoughts")}
            className={cn(
              "relative h-[56px] flex items-center text-[14px] transition-colors",
              activeTab === "thoughts"
                ? "font-bold text-[#111827] dark:text-white"
                : "font-normal text-[#6b7686] dark:text-[#9ca6b5] hover:text-[#111827] dark:hover:text-white"
            )}
          >
            <span>纯想法 ({thoughtsCount})</span>
            {activeTab === "thoughts" && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#182233] dark:bg-white" />
            )}
          </button>
        </nav>
      </div>

      {/* Center: Search & Quick Capture */}
      <div className="flex-1 max-w-[480px] mx-4 hidden lg:flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#9ca6b5] pointer-events-none" />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索标题、摘要、想法… (⌘K)"
            aria-label="搜索标题、摘要、想法…"
            className="h-[36px] w-full rounded-[6px] border border-[#e6e9ec] dark:border-[#2b313a] bg-[#f2f4f6] dark:bg-[#1a1d24] pl-9 pr-8 text-[12px] text-[#111827] dark:text-[#e5e8eb] placeholder:text-[#9ca6b5] focus:outline-none focus:border-[#1e5bbf] transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9ca6b5] hover:text-[#111827] dark:hover:text-white"
              aria-label="清除搜索"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenCapture}
          className="h-[36px] px-3.5 rounded-[6px] bg-[#182233] dark:bg-white text-white dark:text-[#182233] hover:bg-[#253247] dark:hover:bg-[#f1f5f9] transition-colors flex items-center gap-2 shrink-0 cursor-pointer shadow-sm"
          title="快捷键 C"
        >
          <span className="text-[12px] font-medium">+ 录入新卡片</span>
          <span className="text-[11px] text-[#b2bfd9] dark:text-[#6b7280] font-sans font-normal">
            C
          </span>
        </button>
      </div>

      {/* Right: Utilities & Status */}
      <div className="flex items-center gap-3 sm:gap-4">
        <button
          type="button"
          onClick={onOpenImport}
          className="text-[13px] text-[#6b7686] dark:text-[#9ca6b5] hover:text-[#111827] dark:hover:text-white transition-colors cursor-pointer hidden sm:block"
        >
          X 导入
        </button>

        <button
          type="button"
          onClick={onOpenTrash}
          className="text-[13px] text-[#6b7686] dark:text-[#9ca6b5] hover:text-[#111827] dark:hover:text-white transition-colors cursor-pointer flex items-center gap-1"
        >
          <span>回收站</span>
          {trashCount > 0 && (
            <span className="text-[11px] text-[#dc2626] font-medium">({trashCount})</span>
          )}
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          className="text-[13px] text-[#6b7686] dark:text-[#9ca6b5] hover:text-[#111827] dark:hover:text-white transition-colors cursor-pointer"
        >
          设置
        </button>

        {/* Health status badge */}
        <div className="hidden xl:flex items-center gap-1.5 pl-2 border-l border-[#eef0f2] dark:border-[#23262f]">
          <span
            className={cn(
              "size-[7px] rounded-full shrink-0",
              serviceHealthy === true
                ? "bg-[#10b981]"
                : serviceHealthy === false
                  ? "bg-rose-500"
                  : "bg-amber-400 animate-pulse"
            )}
            aria-hidden="true"
          />
          <span className="text-[12px] text-[#6b7686] dark:text-[#9ca6b5] font-sans">
            {serviceHealthy === true
              ? "服务正常运行"
              : serviceHealthy === false
                ? "服务连接异常"
                : "检查服务状态"}
          </span>
        </div>

        {/* Theme toggle */}
        <button
          type="button"
          onClick={cycleTheme}
          className="size-8 flex items-center justify-center rounded-[6px] text-[#6b7686] dark:text-[#9ca6b5] hover:bg-[#f2f4f6] dark:hover:bg-[#1f242d] transition-colors"
          title={`主题 · ${theme === "dark" ? "深色" : theme === "light" ? "浅色" : "系统"}`}
          aria-label="切换明暗主题"
        >
          {theme === "dark" ? (
            <Moon className="size-4" aria-hidden="true" />
          ) : (
            <Sun className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </header>

      {/* Mobile Sub-header Tabs (Figma 96:603) */}
      <nav role="navigation" aria-label="主导航" className="flex md:hidden items-center justify-around h-[40px] border-b border-[#eff1f3] dark:border-[#23262f] bg-white dark:bg-[#14161c] px-4 text-[13px] shrink-0 select-none">
        <button
          type="button"
          onClick={() => onTabChange("inbox")}
          className={cn(
            "h-full flex items-center relative font-medium",
            activeTab === "inbox"
              ? "text-[#111827] dark:text-white font-bold border-b-2 border-[#182233] dark:border-white"
              : "text-[#6b7686] dark:text-[#9ca6b5]"
          )}
        >
          收件箱 ({inboxCount})
        </button>
        <button
          type="button"
          onClick={() => onTabChange("organized")}
          className={cn(
            "h-full flex items-center relative font-medium",
            activeTab === "organized"
              ? "text-[#111827] dark:text-white font-bold border-b-2 border-[#182233] dark:border-white"
              : "text-[#6b7686] dark:text-[#9ca6b5]"
          )}
        >
          已保留 ({organizedCount})
        </button>
        <button
          type="button"
          onClick={() => onTabChange("thoughts")}
          className={cn(
            "h-full flex items-center relative font-medium",
            activeTab === "thoughts"
              ? "text-[#111827] dark:text-white font-bold border-b-2 border-[#182233] dark:border-white"
              : "text-[#6b7686] dark:text-[#9ca6b5]"
          )}
        >
          纯想法 ({thoughtsCount})
        </button>
      </nav>
    </>
  );
}
