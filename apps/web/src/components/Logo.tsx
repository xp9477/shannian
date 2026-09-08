import React from "react";
import { cn } from "@/lib/utils";

interface LogoProps {
  size?: 16 | 18 | 24 | 32;
  showWordmark?: boolean;
  className?: string;
}

/**
 * 闪念官方单色几何矢量标记 (Figma 125:18)
 * 提取自汉字「闪」的“门”(框架视窗) 与“人/斜切光刃”(即时决断)
 * 纯黑白高反差，专为数字出版与沉静阅读定制
 */
export function LogoMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 33 33"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <path
        d="M0.5 0.5H32.5V10.7857H26.7857V6.21429H6.21429V32.5H0.5V0.5ZM11.9286 11.9286H26.7857L17.6429 32.5H9.64286L11.9286 11.9286Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function Logo({ size = 18, showWordmark = true, className }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2 select-none", className)}>
      <div className="text-[#182233] dark:text-white flex items-center justify-center">
        <LogoMark size={size} />
      </div>
      {showWordmark && (
        <div className="flex items-baseline gap-1.5">
          <span className="font-serif font-bold text-[16px] leading-none text-[#182233] dark:text-white tracking-tight">
            闪念
          </span>
          <span className="font-serif font-semibold text-[10px] leading-none text-[#708094] dark:text-[#b2bfd9] tracking-[0.6px]">
            SHANNIAN
          </span>
        </div>
      )}
    </div>
  );
}
