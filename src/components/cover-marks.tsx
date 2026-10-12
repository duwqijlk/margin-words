import { useT } from "@/lib/i18n";
import { cn } from "@/components/ui";

const pill = "rounded px-1.5 text-left text-[0.6rem] leading-4 font-semibold tracking-wide ring-1 backdrop-blur-sm";

/** Small labels on the top-left of a cover. Light pills, so they stay quiet on any cover picture. */
export function CoverBadge({
  tone,
  children,
  onClick,
  disabled,
  title,
  "aria-label": ariaLabel,
  ...rest
}: {
  tone: "publicDomain" | "list" | "needs";
  children: React.ReactNode;
  /** When set, the label is a button. Used for the shelf Update tag. */
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
} & Record<`data-${string}`, unknown>) {
  const className = cn(
    pill,
    onClick && "pointer-events-auto",
    tone === "publicDomain" && "bg-card/85 text-accent ring-black/5",
    tone === "list" && "bg-card/85 text-ink ring-black/5",
    tone === "needs" && "bg-warn text-accent-ink ring-black/10",
    disabled && "opacity-70",
  );
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel} {...rest}>
        {children}
      </button>
    );
  }
  return (
    <span className={className} title={title} aria-label={ariaLabel} {...rest}>
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
