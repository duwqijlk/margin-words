import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n";
import { btn, cn } from "@/components/ui";

export type Step = { art: ReactNode; heading: string; body: string };

/**
 * The frame shared by the first-run tutorial and the feedback tip: a title row with Skip, one
 * picture box, the text, page dots, and one row of buttons. Nothing in it moves from step to step
 * or from one of these dialogs to the other:
 * - the picture box has a fixed shape;
 * - every step's text is laid in the same grid cell, all but this step's hidden, so the text box
 *   is as tall as the longest step in this language and width, and the dialog never changes height;
 * - the button row is always a square Back button and one wide main button (Next, then the last
 *   step's action), with Back kept in place, invisible, on the first step.
 */
export function StepDialog({
  name,
  title,
  steps,
  open,
  onClose,
  finish,
}: {
  /** The data-attribute prefix: data-<name>, data-<name>-step, data-<name>-next, ... */
  name: string;
  title: string;
  steps: Step[];
  open: boolean;
  onClose: () => void;
  /** The main button of the last step. */
  finish: { label: string; onClick: () => void; data: string };
}) {
  const { t } = useT();
  const [step, setStep] = useState(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const last = step === steps.length - 1;
  const go = (next: number) => setStep(Math.max(0, Math.min(steps.length - 1, next)));
  const data = (part = "") => ({ [`data-${name}${part ? `-${part}` : ""}`]: "" });

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/[0.32]" />
        <Dialog.Content
          className="anim-pop fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-1.5rem)] w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-3xl border border-line bg-paper p-5 text-ink shadow-lift outline-none"
          {...data()}
          {...{ [`data-${name}-step`]: step }}
          // Focus the dialog itself, not Skip: a ring around Skip read as the thing to press.
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") go(step + 1);
            if (event.key === "ArrowLeft") go(step - 1);
          }}
          onTouchStart={(event) => {
            const touch = event.touches[0];
            swipe.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
          }}
          onTouchEnd={(event) => {
            const start = swipe.current;
            const touch = event.changedTouches[0];
            swipe.current = null;
            if (!start || !touch) return;
            const dx = touch.clientX - start.x;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(touch.clientY - start.y) * 1.5) go(step + (dx < 0 ? 1 : -1));
          }}
        >
          <div className="flex h-8 items-center justify-between gap-2">
            <Dialog.Title className="truncate text-sm font-semibold text-muted">{title}</Dialog.Title>
            <button
              type="button"
              className="-mr-2 inline-flex min-h-10 shrink-0 items-center rounded-lg px-2 text-sm font-medium text-muted hover:text-ink"
              onClick={onClose}
              {...data("skip")}
            >
              {last ? t("common.close") : t("tutorial.skip")}
            </button>
          </div>

          <div className="grid aspect-[8/5] place-items-center overflow-hidden rounded-2xl bg-paper" {...data("art")}>
            {steps[step]?.art}
          </div>

          <div className="grid content-start" aria-live="polite" {...data("text")}>
            {steps.map((item, index) => (
              <div
                key={item.heading}
                className={cn("col-start-1 row-start-1 grid content-start gap-1.5", index !== step && "invisible")}
                aria-hidden={index !== step}
              >
                <h2 className="font-display text-xl font-semibold leading-snug" {...(index === step ? data("heading") : {})}>
                  {item.heading}
                </h2>
                <p className="text-sm leading-relaxed text-muted">{item.body}</p>
              </div>
            ))}
          </div>
          <Dialog.Description className="sr-only">{steps[step]?.body}</Dialog.Description>

          <div className="-my-1 flex items-center justify-center gap-0.5" role="tablist" aria-label={title}>
            {steps.map((item, index) => (
              <button
                key={item.heading}
                type="button"
                role="tab"
                aria-selected={index === step}
                aria-label={t("tutorial.step", { n: index + 1, total: steps.length })}
                onClick={() => go(index)}
                className="grid size-6 place-items-center"
              >
                <span className={cn("h-1.5 rounded-full transition-all", index === step ? "w-5 bg-accent" : "w-1.5 bg-line")} />
              </button>
            ))}
          </div>

          <div className="grid grid-cols-[2.75rem_1fr] gap-2" {...data("buttons")}>
            <button
              type="button"
              className={cn(btn.quiet, "min-h-11 px-0", step === 0 && "invisible")}
              onClick={() => go(step - 1)}
              aria-label={t("tutorial.back")}
              title={t("tutorial.back")}
              {...data("back")}
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            {last ? (
              <button type="button" className={cn(btn.primary, "min-h-11")} onClick={finish.onClick} {...{ [finish.data]: "" }}>
                {finish.label}
              </button>
            ) : (
              <button type="button" className={cn(btn.primary, "min-h-11")} onClick={() => go(step + 1)} {...data("next")}>
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
