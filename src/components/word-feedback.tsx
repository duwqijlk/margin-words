import { useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/components/ui";
import { Check, HelpCircle } from "lucide-react";

export function WordExplanationFeedback({
  bookId,
  bookTitle,
  word,
  form,
  chapter,
  occurrence,
  paragraph,
  context,
  sentence,
  senseIndex,
  senseMeaning,
  className,
}: {
  bookId: string;
  bookTitle?: string;
  word: string;
  form?: string;
  chapter?: number;
  occurrence?: number;
  paragraph?: number;
  context?: string;
  sentence?: string;
  senseIndex?: number;
  senseMeaning?: string;
  className?: string;
}) {
  const { t } = useT();
  const [submitted, setSubmitted] = useState<"too_hard" | "wrong_meaning" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function sendFeedback(reason: "too_hard" | "wrong_meaning") {
    if (submitting || submitted) return;
    setSubmitting(true);
    try {
      await fetch("/api/feedback/word", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bookId,
          bookTitle,
          word,
          reason,
          form,
          chapter,
          occurrence,
          paragraph,
          context,
          sentence,
          senseIndex,
          senseMeaning,
        }),
      });
      setSubmitted(reason);
    } catch {
      // Graceful fallback: set submitted anyway so user doesn't get frustrated
      setSubmitted(reason);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400",
          className,
        )}
        role="status"
        data-feedback-submitted
      >
        <Check className="size-3.5 shrink-0 stroke-[2.5]" aria-hidden />
        <span>{t("card.feedbackThanks")}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper/50 px-3 py-2 text-xs text-muted",
        className,
      )}
      data-word-feedback
    >
      <div className="flex items-center gap-1 text-[0.72rem] font-semibold tracking-wider text-muted uppercase">
        <HelpCircle className="size-3.5 shrink-0 text-muted" aria-hidden />
        <span>{t("card.feedbackPrompt")}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={submitting}
          onClick={() => void sendFeedback("too_hard")}
          className="inline-flex items-center rounded-lg border border-line/60 bg-card px-2 py-1 text-xs font-medium text-ink/80 transition-colors hover:border-line hover:bg-paper hover:text-ink active:scale-95 disabled:opacity-50"
          title={t("card.feedbackTooHard")}
          data-feedback-too-hard
        >
          {t("card.feedbackTooHard")}
        </button>

        <button
          type="button"
          disabled={submitting}
          onClick={() => void sendFeedback("wrong_meaning")}
          className="inline-flex items-center rounded-lg border border-line/60 bg-card px-2 py-1 text-xs font-medium text-ink/80 transition-colors hover:border-line hover:bg-paper hover:text-ink active:scale-95 disabled:opacity-50"
          title={t("card.feedbackWrong")}
          data-feedback-wrong
        >
          {t("card.feedbackWrong")}
        </button>
      </div>
    </div>
  );
}
