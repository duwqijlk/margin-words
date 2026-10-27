import { useId, useState } from "react";
import { useT } from "@/lib/i18n";
import { SUGGESTION_MAX } from "@/lib/limits";
import { cn } from "@/components/ui";
import { Check, HelpCircle } from "lucide-react";

export type FeedbackReason = "too_hard" | "wrong_meaning" | "missing_meaning" | "suggested";

export function WordExplanationFeedback({
  bookId,
  bookTitle,
  word,
  form,
  chapter,
  chapters,
  catalogId,
  occurrence,
  paragraph,
  context,
  sentence,
  senseIndex,
  senseMeaning,
  glossaryRev,
  missing = false,
  className,
}: {
  bookId: string;
  bookTitle?: string;
  word: string;
  form?: string;
  chapter?: number;
  /** How many chapters this copy of the book has, so a chapter number can be checked. */
  chapters?: number;
  /** The catalog book, `<catalog>:<id>` (src/lib/catalog-id.ts); "" for a list the reader added. */
  catalogId?: string;
  occurrence?: number;
  paragraph?: number;
  context?: string;
  sentence?: string;
  senseIndex?: number;
  senseMeaning?: string;
  glossaryRev?: string;
  /** The book has no meaning for this word: the only report is that it is missing. */
  missing?: boolean;
  className?: string;
}) {
  const { t } = useT();
  const optionsId = useId();
  const [expanded, setExpanded] = useState(false);
  const [submitted, setSubmitted] = useState<FeedbackReason | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The reader's own meaning, optional. Without it a problem button sends at once. While writing,
  // a problem button only marks what was wrong (optional), and Send sends the meaning: a meaning
  // alone already says the one shown should change, so nothing has to be picked first.
  const [writing, setWriting] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [picked, setPicked] = useState<FeedbackReason | null>(missing ? "missing_meaning" : null);
  const choose = (reason: FeedbackReason) =>
    writing ? setPicked((now) => (now === reason && !missing ? null : reason)) : void sendFeedback(reason);
  const reasonClass = (reason: FeedbackReason) =>
    cn(
      "inline-flex items-center rounded-lg border px-2 py-1 text-xs font-medium transition-colors active:scale-95 disabled:opacity-50",
      writing && picked === reason
        ? "border-accent bg-accent text-accent-ink"
        : "border-line/60 bg-card text-ink/80 hover:border-line hover:bg-paper hover:text-ink",
    );
  const canSend = suggestion.trim().length > 0 && !submitting;

  async function sendFeedback(reason: FeedbackReason) {
    if (submitting || submitted) return;
    setSubmitting(true);
    try {
      await fetch("/api/feedback/word", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bookId,
          bookTitle,
          word,
          reason,
          form,
          chapter,
          chapters,
          ...(catalogId ? { catalogId } : {}),
          occurrence,
          paragraph,
          context,
          sentence,
          senseIndex,
          senseMeaning,
          glossaryRev,
          ...(suggestion.trim() ? { suggestion: suggestion.trim().slice(0, SUGGESTION_MAX) } : {}),
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
        "flex flex-wrap items-center justify-end gap-2 text-xs text-muted",
        // While the reader writes a meaning, take the whole row so the box is full width.
        writing && "order-first basis-full justify-start",
        className,
      )}
      data-word-feedback
    >
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="grid size-11 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-paper hover:text-ink md:size-8"
        aria-label={t("card.feedbackPrompt")}
        title={t("card.feedbackPrompt")}
        aria-expanded={expanded}
        aria-controls={expanded ? optionsId : undefined}
        data-feedback-toggle
      >
        <HelpCircle className="size-4" aria-hidden />
      </button>

      {expanded ? (
        <div id={optionsId} className="flex flex-wrap items-center gap-2" data-feedback-options>
          {missing ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => choose("missing_meaning")}
              className={reasonClass("missing_meaning")}
              aria-pressed={writing ? picked === "missing_meaning" : undefined}
              title={t("card.feedbackMissing")}
              data-feedback-missing
            >
              {t("card.feedbackMissing")}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={submitting}
                onClick={() => choose("too_hard")}
                className={reasonClass("too_hard")}
                aria-pressed={writing ? picked === "too_hard" : undefined}
                title={t("card.feedbackTooHard")}
                data-feedback-too-hard
              >
                {t("card.feedbackTooHard")}
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={() => choose("wrong_meaning")}
                className={reasonClass("wrong_meaning")}
                aria-pressed={writing ? picked === "wrong_meaning" : undefined}
                title={t("card.feedbackWrong")}
                data-feedback-wrong
              >
                {t("card.feedbackWrong")}
              </button>
            </>
          )}
          {writing ? null : (
            <button
              type="button"
              disabled={submitting}
              onClick={() => setWriting(true)}
              className="inline-flex min-h-8 items-center px-1 text-xs font-medium text-accent hover:underline disabled:opacity-50"
              data-feedback-add-meaning
            >
              {t("card.feedbackAddMeaning")}
            </button>
          )}
        </div>
      ) : null}
      {expanded && writing ? (
        <div className="grid basis-full gap-1" data-feedback-suggestion>
          <textarea
            className="min-h-16 w-full resize-none rounded-lg border border-line/80 bg-card px-2.5 py-2 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"
            value={suggestion}
            maxLength={SUGGESTION_MAX}
            rows={2}
            autoFocus
            placeholder={t("card.feedbackMeaningPlaceholder")}
            aria-label={t("card.feedbackAddMeaning")}
            onChange={(event) => setSuggestion(event.target.value.slice(0, SUGGESTION_MAX))}
            data-feedback-suggestion-input
          />
          <p className="flex justify-between gap-2 text-[0.7rem] text-muted">
            <span>{t(missing ? "card.feedbackMeaningHint" : "card.feedbackMeaningOptional")}</span>
            <span className="tabular-nums" data-feedback-suggestion-count>
              {[...suggestion].length}/{SUGGESTION_MAX}
            </span>
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setWriting(false);
                setSuggestion("");
                setPicked(missing ? "missing_meaning" : null);
              }}
              className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-medium text-muted hover:text-ink"
              data-feedback-suggestion-cancel
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void sendFeedback(picked ?? "suggested")}
              className="inline-flex min-h-9 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
              data-feedback-suggestion-send
            >
              {submitting ? t("account.working") : t("card.feedbackSend")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
