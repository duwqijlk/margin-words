import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useT, type Key } from "@/lib/i18n";
import { useFeedbackTip } from "@/lib/tutorial";
import { ArtFeedbackHard, ArtFeedbackMissing } from "@/components/tutorial-art";
import { btn, cn } from "@/components/ui";

const STEPS: Array<{ title: Key; body: Key }> = [
  { title: "tip.s1Title", body: "tip.s1Body" },
  { title: "tip.s2Title", body: "tip.s2Body" },
];

/**
 * After the reader's first word list is paired with their own EPUB, the book opens and this tip
 * shows once (src/lib/tutorial.ts): tell us when a meaning is still too hard, and when a hard word
 * is not marked. Both reports come from the word card's ? button (word-feedback.tsx).
 */
export default function FeedbackTipDialog() {
  const { t } = useT();
  const open = useFeedbackTip((state) => state.open);
  const hide = useFeedbackTip((state) => state.hide);
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : hide())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content
          className="anim-pop fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-1.5rem)] w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-3xl border border-line bg-card p-5 text-ink shadow-pop outline-none"
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
          }}
          data-feedback-tip
          data-feedback-tip-step={step}
        >
          <Dialog.Title className="text-sm font-semibold text-muted">{t("tip.title")}</Dialog.Title>
          <div className="grid aspect-[8/5] place-items-center overflow-hidden rounded-2xl bg-paper">
            {step === 0 ? (
              <ArtFeedbackHard
                label={t(STEPS[0].title)}
                tooHard={t("card.feedbackTooHard")}
                addMine={t("card.feedbackAddMeaning")}
                thanks={t("tutorial.tagThanks")}
              />
            ) : (
              <ArtFeedbackMissing label={t(STEPS[1].title)} missing={t("card.feedbackMissing")} />
            )}
          </div>
          <div className="grid gap-1.5" aria-live="polite">
            <h2 className="font-display text-xl font-semibold leading-snug" data-feedback-tip-heading>
              {t(STEPS[step].title)}
            </h2>
            <Dialog.Description className="text-sm leading-relaxed text-muted">{t(STEPS[step].body)}</Dialog.Description>
          </div>
          <div className="flex items-center justify-center gap-2" aria-hidden>
            {STEPS.map((item, index) => (
              <span key={item.title} className={cn("h-1.5 rounded-full", index === step ? "w-5 bg-accent" : "w-1.5 bg-line")} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={cn(btn.quiet, "min-h-11", step === 0 && "invisible")}
              onClick={() => setStep(0)}
              data-feedback-tip-back
            >
              <ChevronLeft className="size-4" aria-hidden />
              {t("tutorial.back")}
            </button>
            {last ? (
              <button type="button" className={cn(btn.primary, "min-h-11")} onClick={hide} data-feedback-tip-done>
                {t("tip.done")}
              </button>
            ) : (
              <button type="button" className={cn(btn.primary, "min-h-11")} onClick={() => setStep(1)} data-feedback-tip-next>
                {t("tutorial.next")}
                <ChevronRight className="size-4" aria-hidden />
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
