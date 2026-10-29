import { CheckCircle2 } from "lucide-react";
import { useMemo } from "react";
import { useT } from "@/lib/i18n";
import { readingOverview } from "@/lib/reading-stats";
import { useVocab } from "@/lib/vocab-store";
import { cn } from "@/components/ui";

/** "Finished 3 books · 12 days of reading · 245 words saved" on the shelf. Hidden until there is something to count. */
export function ReadingOverviewLine({ className }: { className?: string }) {
  const { t, tn } = useT();
  const books = useVocab((state) => state.books);
  const words = useVocab((state) => state.words);
  const readDays = useVocab((state) => state.readDays);
  const overview = useMemo(() => readingOverview(books, words, readDays), [books, words, readDays]);
  if (overview.finished.length === 0 && overview.readDays === 0 && overview.words === 0) return null;
  const parts = [
    tn("overview.finished", overview.finished.length),
    tn("overview.days", overview.readDays),
    tn("overview.words", overview.words),
  ];
  return (
    <section
      className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted", className)}
      aria-label={t("overview.title")}
      data-reading-overview
    >
      <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
        <CheckCircle2 className="size-4 text-accent" aria-hidden />
        {t("overview.title")}
      </span>
      {parts.map((part, index) => (
        <span key={index} className="tabular-nums" data-overview-part={index}>
          {part}
        </span>
      ))}
    </section>
  );
}
