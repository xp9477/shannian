import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "./button";

export function Sheet({ open, onOpenChange, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </Dialog.Root>
  );
}

export function SheetContent({
  className,
  children,
  side = "right",
  title = "面板",
}: {
  className?: string;
  children: React.ReactNode;
  side?: "right" | "left" | "bottom";
  title?: string;
}) {
  const isBottom = side === "bottom";
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] data-[state=open]:animate-in" />
      <Dialog.Content
        className={cn(
          "fixed z-50 flex flex-col border-[var(--color-border)] bg-[var(--color-card)] shadow-xl outline-none",
          isBottom
            ? "inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t"
            : "top-0 h-full w-full sm:max-w-md",
          side === "right" && "right-0 border-l",
          side === "left" && "left-0 border-r",
          className
        )}
      >
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        {isBottom && (
          <div className="flex justify-center pt-2 pb-1">
            <div className="h-1 w-10 rounded-full bg-[var(--color-border)]" />
          </div>
        )}
        <div className="absolute right-3 top-3 z-10">
          <Dialog.Close asChild>
            <Button variant="ghost" size="icon" aria-label="关闭">
              <X />
            </Button>
          </Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
