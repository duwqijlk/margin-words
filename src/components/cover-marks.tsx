import { useT } from "@/lib/i18n";
import { cn } from "@/components/ui";

/**
 * Book facts that used to sit on the cover as pills (Public domain, Word list, Old-fashioned,
 * Needs your e-book, Update, words due). The cover now shows only its art, and these go under the
 * author as quiet text, one per line: cards are narrow on a phone, and a line joined by dots
 * wrapped with a dot at the start. Each part keeps its `data-*` hook.
 */
export function BookTags({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid min-w-0 justify-items-start gap-0.5 text-xs leading-4 text-muted",
        className,
      )}
      data-book-tags=""
    >
      {children}
    </div>
  );
}

/**
 * One fact in `BookTags`. `warn` is for what needs the reader (a missing e-book); `action` is
 * something to do (Update). Both are status lines: a 6px dot and 13px semibold text (design system
 * BookItem, ColorRoles).
 */
export function BookTag({
  tone = "plain",
  children,
  onClick,
  disabled,
  title,
  "aria-label": ariaLabel,
  ...rest
}: {
  tone?: "plain" | "warn" | "action";
  children: React.ReactNode;
  /** When set, the tag is a button. Used for Update. */
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
} & Record<`data-${string}`, unknown>) {
  const className = cn(
    "inline-flex max-w-full items-center gap-1 truncate",
    tone === "warn" && "book-status text-warn",
    tone === "action" && "book-status text-accent underline-offset-2 hover:underline disabled:opacity-60",
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={cn(className, "-my-2 min-h-8 py-2")}
        onClick={onClick}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        {...rest}
      >
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

/** The English is too old for a beginner. The reason is in the tooltip. */
export function OldFashionedTag({ reason }: { reason?: string }) {
  const { t } = useT();
  const note = t("shelf.oldFashionedNote");
  const tip = reason ? `${note} — ${reason}` : note;
  return (
    <BookTag data-old-fashioned="" title={tip} aria-label={tip}>
      {t("shelf.oldFashioned")}
    </BookTag>
  );
}
