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
        "flex flex-col items-center justify-center px-6 py-16 text-center",
        className
      )}
    >
      {icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
          {icon}
        </div>
      )}
      <div className="text-sm font-medium tracking-tight">{title}</div>
      {description && (
        <p className="mt-1.5 max-w-sm text-xs text-[var(--color-muted-foreground)]">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
