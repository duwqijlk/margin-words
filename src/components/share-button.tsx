import { Share2 } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useT } from "@/lib/i18n";
import { btn, cn } from "@/components/ui";
import type { ShareWhat } from "@/components/share-dialog";

// The dialog brings the canvas drawing and the QR encoder: loaded on the first tap only.
const ShareDialog = lazy(() => import("@/components/share-dialog"));

/** The share dialog, loaded when it first opens. For a menu item or any other opener. */
export function LazyShareDialog({ what, open, onOpenChange }: { what: ShareWhat; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <ShareDialog what={what} open={open} onOpenChange={onOpenChange} />
    </Suspense>
  );
}

export function ShareButton({
  what,
  className,
  quiet = false,
  label,
}: {
  what: ShareWhat;
  className?: string;
  quiet?: boolean;
  /** Defaults to "Share". */
  label?: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={cn(quiet ? btn.quiet : btn.primary, className)}
        onClick={() => setOpen(true)}
        data-share-open={what.kind}
      >
        <Share2 className="size-4" aria-hidden />
        {label ?? t("share.button")}
      </button>
      <LazyShareDialog what={what} open={open} onOpenChange={setOpen} />
    </>
  );
}
