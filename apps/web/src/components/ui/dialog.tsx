import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "./button";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
  className,
  children,
  title,
}: {
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[1px]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-2xl outline-none",
          className
        )}
      >
        {title && (
          <DialogPrimitive.Title className="mb-3 text-base font-semibold tracking-tight">
            {title}
          </DialogPrimitive.Title>
        )}
        {!title && <DialogPrimitive.Title className="sr-only">对话框</DialogPrimitive.Title>}
        <div className="absolute right-3 top-3">
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label="关闭">
              <X />
            </Button>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
