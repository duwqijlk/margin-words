import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { btn, cn } from "@/components/ui";
import { useT } from "@/lib/i18n";

/** The overview popup. It shows the numbers. It does not open QQ. */
export function QqDialog({
  open,
  onOpenChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly string[];
}) {
  const { t } = useT();
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (!open) setCopied("");
  }, [open]);

  async function copy(number: string) {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(number);
    } catch {
      setCopied("");
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/[0.32]" />
        <Dialog.Content className="anim-pop fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-paper p-5 text-ink shadow-lift sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-bold tracking-[-0.02em] text-2xl">{t("dashboard.qqTitle")}</Dialog.Title>
            <Dialog.Close className={cn(btn.icon, "-mt-1 -mr-2")} aria-label={t("common.close")}>
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-2 text-sm text-muted">{t("dashboard.qqHint")}</Dialog.Description>
          <ul className="mt-4 grid gap-2" data-qq-groups>
            {groups.map((number) => (
              <li key={number} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2" data-qq-group={number}>
                <span className="font-mono text-lg tabular-nums">{number}</span>
                <button type="button" className={cn(btn.quiet, "min-h-9 px-3 text-sm")} onClick={() => void copy(number)} data-qq-copy={number}>
                  {copied === number ? t("dashboard.qqCopied") : t("dashboard.qqCopy")}
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
