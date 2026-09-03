import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  Download,
  Inbox,
  Lightbulb,
  Menu,
  Moon,
  Settings,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { applyTheme, getThemeMode, setThemeMode, type ThemeMode } from "@/lib/theme";
import { requestCaptureFocus } from "@/lib/capture-focus";

export type NavFilter = {
  status?: string;
  thoughtsOnly?: boolean;
  categoryId?: string;
};

export function AppShell({
  children,
  inboxCount = 0,
  categories = [],
  filter = {},
  onFilterChange,
}: {
  children: React.ReactNode;
  inboxCount?: number;
  categories?: { id: string; name: string }[];
  filter?: NavFilter;
  onFilterChange?: (f: NavFilter) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNav, setMobileNav] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(getThemeMode());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function cycleTheme() {
    const order: ThemeMode[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setThemeMode(next);
    setTheme(next);
  }

  function goHome(next: NavFilter) {
    if (location.pathname === "/" && onFilterChange) {
      onFilterChange(next);
    } else {
      const params = new URLSearchParams();
      if (next.status) params.set("status", next.status);
      if (next.thoughtsOnly) params.set("thoughtsOnly", "1");
      if (next.categoryId) params.set("categoryId", next.categoryId);
      const search = params.toString();
      navigate(search ? `/?${search}` : "/");
    }
    setMobileNav(false);
  }

  /** A2: jump home + focus hairline capture (no dialog / no ⌘K) */
  function goCapture() {
    setMobileNav(false);
    if (location.pathname !== "/") {
      navigate("/", { state: { focusCapture: true } });
    } else {
      requestCaptureFocus();
    }
  }

  const isHome = location.pathname === "/";
  const status = filter.status;
  const thoughtsOnly = Boolean(filter.thoughtsOnly);

  const navBtn = (
    active: boolean,
    onClick: () => void,
    icon: React.ReactNode,
    label: string,
    badge?: number
  ) => (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition-colors duration-150",
        active
          ? "nav-active"
          : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      {badge != null && badge > 0 && (
        <span className="ml-auto rounded-full bg-amber-100/90 px-1.5 py-px text-[10.5px] font-semibold tabular-nums text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {badge}
        </span>
      )}
    </button>
  );

  const sidebar = (
    <nav
      className="flex h-full w-[15.5rem] flex-col border-r border-[var(--color-sidebar-border)] bg-[var(--color-sidebar)]"
      aria-label="主导航"
    >
      <div className="flex h-[3.75rem] items-center gap-2.5 px-4">
        <div
          className="flex size-8 items-center justify-center rounded-[10px] bg-[var(--color-primary)] text-[13px] font-bold tracking-tight text-[var(--color-primary-foreground)]"
          aria-hidden
        >
          闪
        </div>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold tracking-tight">闪念</div>
          <div className="truncate text-[11px] text-[var(--color-muted-foreground)]">
            分流台
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto md:hidden"
          onClick={() => setMobileNav(false)}
          aria-label="关闭菜单"
        >
          <X />
        </Button>
      </div>

      <div className="space-y-1.5 px-3 pb-3">
        <Button className="w-full justify-start rounded-xl shadow-sm" size="sm" onClick={goCapture}>
          <span className="mr-1 text-base leading-none font-light" aria-hidden>
            +
          </span>
          快速添加
        </Button>
        <Link
          to="/import"
          onClick={() => setMobileNav(false)}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-colors",
            location.pathname === "/import"
              ? "nav-active"
              : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          )}
        >
          <Download className="size-4 shrink-0" aria-hidden />
          平台导入
        </Link>
      </div>

      <ScrollArea className="flex-1 px-2">
        <div className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted-foreground)]/80">
          收藏
        </div>
        <div className="flex flex-col gap-0.5 p-1">
          {navBtn(
            isHome && status === "inbox" && !thoughtsOnly,
            () => goHome({ status: "inbox" }),
            <Inbox className="size-4 shrink-0 opacity-80" aria-hidden />,
            "收件箱",
            inboxCount
          )}
          {navBtn(
            isHome && status === "organized" && !thoughtsOnly,
            () => goHome({ status: "organized" }),
            <CheckCircle2 className="size-4 shrink-0 opacity-80" aria-hidden />,
            "已保留"
          )}
          {navBtn(
            isHome && thoughtsOnly,
            () => goHome({ thoughtsOnly: true }),
            <Lightbulb className="size-4 shrink-0 opacity-80" aria-hidden />,
            "想法"
          )}
        </div>

        <Separator className="my-2.5 opacity-60" />

        <div className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted-foreground)]/80">
          分类
        </div>
        <div className="flex flex-col gap-0.5 p-1 pb-4">
          {categories.length === 0 && (
            <div className="px-2.5 py-2 text-xs text-[var(--color-muted-foreground)]">暂无分类</div>
          )}
          {categories.map((c) =>
            navBtn(
              isHome && filter.categoryId === c.id,
              () =>
                goHome({
                  status: filter.status,
                  thoughtsOnly: filter.thoughtsOnly,
                  categoryId: filter.categoryId === c.id ? undefined : c.id,
                }),
              <span
                className="size-1.5 shrink-0 rounded-full bg-[var(--color-primary)]/70"
                aria-hidden
              />,
              c.name
            )
          )}
        </div>
      </ScrollArea>

      <div className="flex flex-col gap-0.5 border-t border-[var(--color-sidebar-border)] p-2">
        <button
          type="button"
          onClick={cycleTheme}
          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
        >
          {theme === "dark" ? (
            <Moon className="size-4" aria-hidden />
          ) : (
            <Sun className="size-4" aria-hidden />
          )}
          主题 · {theme === "system" ? "系统" : theme === "light" ? "浅色" : "深色"}
        </button>
        <Link
          to="/trash"
          onClick={() => setMobileNav(false)}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] transition-colors",
            location.pathname === "/trash"
              ? "nav-active"
              : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          )}
        >
          <Trash2 className="size-4" aria-hidden />
          回收站
        </Link>
        <Link
          to="/settings"
          onClick={() => setMobileNav(false)}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] transition-colors",
            location.pathname === "/settings"
              ? "nav-active"
              : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          )}
        >
          <Settings className="size-4" aria-hidden />
          设置
        </Link>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full bg-[var(--color-background)] text-[var(--color-foreground)]">
      <a href="#main-content" className="skip-link">
        跳到主内容
      </a>
      <aside className="hidden md:flex">{sidebar}</aside>

      {mobileNav && (
        <div className="fixed inset-0 z-40 flex md:hidden" role="dialog" aria-modal="true" aria-label="导航菜单">
          <div className="w-[15.5rem] shadow-xl">{sidebar}</div>
          <button
            type="button"
            className="flex-1 bg-black/30"
            onClick={() => setMobileNav(false)}
            aria-label="关闭菜单遮罩"
          />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b border-[var(--color-border)] px-3 md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileNav(true)} aria-label="打开菜单">
            <Menu />
          </Button>
          <div className="text-sm font-semibold">闪念</div>
          <Button
            className="ml-auto"
            size="sm"
            variant="outline"
            onClick={() => {
              setMobileNav(false);
              navigate("/import");
            }}
          >
            导入
          </Button>
          <Button size="sm" variant="ghost" onClick={goCapture} aria-label="快速添加">
            +
          </Button>
        </header>
        <main id="main-content" className="min-h-0 flex-1 overflow-auto scroll-thin" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
