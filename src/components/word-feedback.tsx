import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, HelpCircle, PenLine } from "lucide-react";
import { useT, type Key } from "@/lib/i18n";
import { SUGGESTION_MAX } from "@/lib/limits";
import { CreditLine } from "@/components/credit-line";
import { cn } from "@/components/ui";

export type FeedbackReason = "too_hard" | "wrong_meaning" | "missing_meaning" | "suggested";

/** Where a report is about: the same fields as before the redesign. */
export type FeedbackTarget = {
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
};

async function send(target: FeedbackTarget, reason: FeedbackReason, suggestion?: string): Promise<void> {
  const { catalogId, ...rest } = target;
  try {
    await fetch("/api/feedback/word", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...rest,
        ...(catalogId ? { catalogId } : {}),
        reason,
        ...(suggestion ? { suggestion: suggestion.slice(0, SUGGESTION_MAX) } : {}),
      }),
    });
  } catch {
    // A failed report still shows as received: the reader cannot do more about it.
  }
}

/**
 * Where the feedback flow is. `choose`: the three choices. `reason`: a reason was sent. `writing`:
 * the reader writes a meaning. `wrote`: the meaning was sent.
 */
type Step =
  | { kind: "choose" }
  | { kind: "reason"; reason: "too_hard" | "wrong_meaning" | "missing_meaning" }
  | { kind: "writing"; back: "choose" | "reason"; reason?: "too_hard" | "wrong_meaning" | "missing_meaning" }
  | { kind: "wrote" };

const REASON_LABEL: Record<"too_hard" | "wrong_meaning", Key> = {
  too_hard: "card.feedbackTooHard",
  wrong_meaning: "card.feedbackWrong",
};

/**
 * The meaning on the word card and the meaning feedback around it (design system WordCard and
 * WordFeedback).
 *
 * With a meaning: the meaning (Literata, like a dictionary) ends with a small ? button. It opens a box
 * right under the meaning (and its credit): "What is wrong with this meaning?" with Too hard / Wrong,
 * which send at once, and Write my own. A sent reason turns into one line with a link to write a better
 * meaning, and the ? turns into a green check.
 *
 * Without one ("No meaning for this word in this book yet"): that message carries the two actions,
 * Tell us it is missing and Write my own. There is no ? to find.
 *
 * A reason and a written meaning are two separate reports; every button always means the same thing.
 * A meaning written for a word without one is sent as missing_meaning with the suggestion, so the
 * patrol still sees a word to add; otherwise it is `suggested`.
 */
export function WordMeaning({
  meaning,
  pos,
  credit,
  missing,
  noList = false,
  part,
  target,
  children,
}: {
  meaning: string;
  pos?: string;
  credit?: string;
  /** The book has no meaning for this word. */
  missing: boolean;
  /** The book has no word list at all: one more line under the missing message. */
  noList?: boolean;
  part: "word-meaning" | "phrase-meaning";
  target: FeedbackTarget;
  /** Shown under the meaning and its credit (the coined-word badge). */
  children?: ReactNode;
}) {
  const { t } = useT();
  const boxId = useId();
  const helpRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(missing);
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [busy, setBusy] = useState<FeedbackReason | null>(null);
  const [text, setText] = useState("");
  const sentSomething = step.kind === "reason" || step.kind === "wrote";

  // Esc closes the box and gives focus back to the ?.
  useEffect(() => {
    if (!open || missing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      helpRef.current?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, missing]);

  async function sendReason(reason: "too_hard" | "wrong_meaning" | "missing_meaning") {
    if (busy) return;
    setBusy(reason);
    await send(target, reason);
    setBusy(null);
    setStep({ kind: "reason", reason });
  }

  async function sendMeaning() {
    const value = text.trim();
    if (!value || busy) return;
    const reason: FeedbackReason = missing ? "missing_meaning" : "suggested";
    setBusy(reason);
    await send(target, reason, value);
    setBusy(null);
    setText("");
    setStep({ kind: "wrote" });
  }

  const startWriting = () =>
    setStep((now) => ({
      kind: "writing",
      back: now.kind === "reason" ? "reason" : "choose",
      reason: now.kind === "reason" ? now.reason : undefined,
    }));
  const cancelWriting = () => {
    setText("");
    setStep((now) =>
      now.kind === "writing" && now.back === "reason" && now.reason ? { kind: "reason", reason: now.reason } : { kind: "choose" },
    );
  };

  const choice = (label: string, onClick: () => void, data: Record<string, string>, extra?: string, icon?: ReactNode) => (
    <button
      type="button"
      onClick={onClick}
      disabled={busy !== null && !data["aria-busy"]}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded border border-edge bg-card px-3 text-sm font-bold text-ink transition-colors duration-100 hover:border-accent hover:text-accent active:scale-[0.96] aria-busy:border-accent aria-busy:bg-accent-soft aria-busy:text-accent",
        extra,
      )}
      {...data}
    >
      {icon}
      {label}
    </button>
  );

  const writeButton = choice(
    t("card.feedbackAddMeaning"),
    startWriting,
    { "data-feedback-add-meaning": "" },
    "border-dashed border-accent/70 text-accent",
    <PenLine className="size-4" aria-hidden />,
  );

  const body = (() => {
    if (step.kind === "writing") {
      return (
        <div className="grid gap-2" data-feedback-suggestion>
          <p className="text-[0.8125rem] font-bold text-muted">{t("card.feedbackWritePrompt")}</p>
          <textarea
            // 16px everywhere: iOS Safari zooms the whole page into a smaller field and stays zoomed.
            className="min-h-[72px] w-full resize-none rounded border border-edge bg-card px-2.5 py-2 font-display text-base leading-normal text-ink placeholder:text-faint focus:border-accent focus:shadow-[0_0_0_1px_rgb(var(--accent-rgb))] focus:outline-none"
            value={text}
            maxLength={SUGGESTION_MAX}
            rows={2}
            autoFocus
            lang="en"
            placeholder={t("card.feedbackMeaningPlaceholder")}
            aria-label={t("card.feedbackWritePrompt")}
            onChange={(event) => setText(event.target.value.slice(0, SUGGESTION_MAX))}
            data-feedback-suggestion-input
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-faint">
            <span>
              <span className="tabular-nums" data-feedback-suggestion-count>
                {[...text].length}/{SUGGESTION_MAX}
              </span>{" "}
              {t("card.feedbackMeaningHint")}
            </span>
            <span className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={cancelWriting}
                className="inline-flex min-h-9 items-center rounded px-3 text-sm font-bold text-muted transition-colors hover:bg-sheet hover:text-ink"
                data-feedback-suggestion-cancel
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={!text.trim() || busy !== null}
                aria-busy={busy !== null || undefined}
                onClick={() => void sendMeaning()}
                className="inline-flex min-h-9 items-center rounded bg-accent px-4 text-sm font-bold text-accent-ink transition-colors hover:bg-accent/90 disabled:opacity-40 aria-busy:bg-accent-soft aria-busy:text-accent"
                data-feedback-suggestion-send
              >
                {t("card.feedbackSend")}
              </button>
            </span>
          </div>
        </div>
      );
    }
    if (step.kind === "reason" || step.kind === "wrote") {
      const line =
        step.kind === "wrote"
          ? t("card.feedbackWrote")
          : step.reason === "missing_meaning"
            ? t("card.feedbackMissingDone")
            : t("card.feedbackReasonDone", { reason: t(REASON_LABEL[step.reason]) });
      return (
        <div
          className={cn("grid grid-cols-[16px_minmax(0,1fr)] items-start gap-x-2 gap-y-1 text-sm leading-snug text-ink", missing ? "" : "rounded-2xl bg-accent-soft p-3")}
          role="status"
          data-feedback-submitted
        >
          <Check className="mt-0.5 size-4 stroke-[2.5] text-accent" aria-hidden />
          <span>{line}</span>
          {step.kind === "reason" ? (
            <button
              type="button"
              onClick={startWriting}
              className="col-start-2 justify-self-start font-bold text-accent underline underline-offset-[3px]"
              data-feedback-write-after
            >
              {t(missing ? "card.feedbackWriteOwn" : "card.feedbackWriteBetter")}
            </button>
          ) : null}
        </div>
      );
    }
    return (
      <div className="flex flex-wrap gap-2">
        {missing ? (
          choice(t("card.feedbackMissing"), () => void sendReason("missing_meaning"), {
            "data-feedback-missing": "",
            ...(busy === "missing_meaning" ? { "aria-busy": "true" } : {}),
          })
        ) : (
          <>
            {choice(t("card.feedbackTooHard"), () => void sendReason("too_hard"), {
              "data-feedback-too-hard": "",
              ...(busy === "too_hard" ? { "aria-busy": "true" } : {}),
            })}
            {choice(t("card.feedbackWrong"), () => void sendReason("wrong_meaning"), {
              "data-feedback-wrong": "",
              ...(busy === "wrong_meaning" ? { "aria-busy": "true" } : {}),
            })}
          </>
        )}
        {writeButton}
      </div>
    );
  })();

  if (missing) {
    return (
      <div className="grid gap-2.5 rounded-2xl bg-accent-soft p-3" data-word-primary>
        <p className="text-[0.9375rem] leading-snug" role="status" data-part="no-meaning">
          {t("card.noMeaning")}
          {noList ? <span className="mt-1 block text-muted">{t("card.noList")}</span> : null}
        </p>
        <div role="group" aria-label={t("card.feedbackPrompt")} data-feedback-options>
          {body}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="grid gap-2" data-word-primary>
      {pos ? <p className="break-words text-sm italic leading-snug text-muted" lang="en" data-word-pos>{pos}</p> : null}
      <p className="font-display text-[1.25rem] leading-normal text-ink" lang="en" data-part={part}>
        <span>{meaning}</span>
        {/* The ? sits after the last word: 24px drawn, 40px to tap, and it does not make the line taller. */}
        <button
          ref={helpRef}
          type="button"
          onClick={() => setOpen((now) => !now)}
          className={cn(
            "relative ml-1 -my-1.5 inline-grid size-6 place-items-center rounded align-[-3px] transition-colors duration-100 after:absolute after:-inset-2 after:content-[''] hover:bg-sheet hover:text-ink",
            open ? "bg-sheet text-ink" : sentSomething ? "text-accent" : "text-faint",
          )}
          aria-label={t("card.feedbackPrompt")}
          title={t("card.feedbackPrompt")}
          aria-expanded={open}
          aria-controls={open ? boxId : undefined}
          data-feedback-toggle
          data-word-feedback
          data-feedback-done={sentSomething || undefined}
        >
          {sentSomething ? (
            <Check className="size-4 stroke-[2.5]" aria-hidden />
          ) : (
            <HelpCircle className="size-4 stroke-2" aria-hidden />
          )}
        </button>
      </p>
      {credit ? <CreditLine id={credit} /> : null}
      {children}
      {open ? (
        step.kind === "reason" || step.kind === "wrote" ? (
          <div id={boxId} className="anim-rise" data-feedback-options>
            {body}
          </div>
        ) : (
          <div
            id={boxId}
            role="group"
            aria-label={t("card.feedbackQuestion")}
            className="anim-rise grid gap-2.5 rounded-2xl bg-sheet p-3"
            data-feedback-options
          >
            {step.kind === "choose" ? <p className="text-[0.8125rem] font-bold text-muted">{t("card.feedbackQuestion")}</p> : null}
            {body}
          </div>
        )
      ) : null}
    </div>
  );
}
