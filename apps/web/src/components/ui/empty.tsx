import { cn } from "@/lib/utils";

export function Empty({
  className,
  icon,
  title,
  description,
  action,
}: {
  className?: string;
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-20 text-center",
        className
      )}
    >
      {icon && (
        <div className="mb-4 flex size-11 items-center justify-center rounded-[12px] border border-[var(--color-border)] bg-[var(--color-muted)]/80 text-[var(--color-muted-foreground)]">
          {icon}
        </div>
      )}
      <div className="text-[15px] font-medium tracking-tight">{title}</div>
      {description && (
        <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
