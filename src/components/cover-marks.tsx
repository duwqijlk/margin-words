import { useT } from "@/lib/i18n";
import { cn } from "@/components/ui";

const pill = "rounded-full px-2 py-0.5 text-left text-[0.68rem] leading-4 font-bold shadow-sm ring-1";

/** Small labels on the top-left of a cover. Light pills, so they stay quiet on any cover picture. */
export function CoverBadge({
  tone,
  children,
  ...rest
}: {
  tone: "publicDomain" | "list" | "needs";
  children: React.ReactNode;
} & Record<`data-${string}`, unknown>) {
  return (
    <span
      className={cn(
        pill,
        tone === "publicDomain" && "bg-card/95 text-accent ring-black/10",
        tone === "list" && "bg-card/95 text-ink ring-black/10",
        tone === "needs" && "bg-warn text-accent-ink ring-black/10",
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

/** Warm badge on the cover when the English is too old for a beginner. */
export function OldFashionedBadge({ reason }: { reason?: string }) {
  const { t } = useT();
  const note = t("shelf.oldFashionedNote");
  const tip = reason ? `${note} — ${reason}` : note;
  return (
    <span
      className={cn(pill, "pointer-events-auto max-w-full bg-[#f4e4d4] text-[#6b3e22] ring-[#8a5a3c]/40")}
      data-old-fashioned=""
      title={tip}
      role="img"
      aria-label={tip}
    >
      {t("shelf.oldFashioned")}
    </span>
  );
}
