import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT, type Key } from "@/lib/i18n";
import { compareSeriesPlace } from "@/lib/discover-rails";
import { resolveAgainst } from "@/lib/packs";
import { navigate } from "@/lib/router";
import { STARTER_SERIES, useDiscoverIntent, useTutorial } from "@/lib/tutorial";
import { loadWordListCatalog, WORD_LIST_CATALOG_URL } from "@/lib/word-list-catalog";
import { BookCover } from "@/components/book-cover";
import { ArtDiscover, ArtEpub, ArtTapWord, ArtWordList } from "@/components/tutorial-art";
import { btn, cn } from "@/components/ui";

type Starter = { id: string; title: string; author: string; cover: string };

/** The first books of the starter series, with their covers, from the word-list catalog. */
function useStarterBooks(): Starter[] {
  const [books, setBooks] = useState<Starter[]>([]);
  useEffect(() => {
    let alive = true;
    void loadWordListCatalog()
      .then((packs) => {
        if (!alive) return;
        const series = packs
          .filter((pack) => pack.series === STARTER_SERIES && pack.category !== "speech")
          .sort(compareSeriesPlace)
          .slice(0, 3)
          .map((pack) => ({
            id: pack.id,
            title: pack.title,
            author: pack.author,
            cover: pack.cover?.url ? resolveAgainst(WORD_LIST_CATALOG_URL, pack.cover.url) : "",
          }));
        setBooks(series);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return books;
}

const STEPS: Array<{ title: Key; body: Key }> = [
  { title: "tutorial.s1Title", body: "tutorial.s1Body" },
  { title: "tutorial.s2Title", body: "tutorial.s2Body" },
  { title: "tutorial.s3Title", body: "tutorial.s3Body" },
  { title: "tutorial.s4Title", body: "tutorial.s4Body" },
  { title: "tutorial.s5Title", body: "tutorial.s5Body" },
];

/**
 * How this reader works, in five animated steps: every book has its own word list, so a book is
 * found in Discover, paired with the reader's own EPUB, and read by tapping words. The last step
 * recommends the Magic Tree House series and opens it in Discover. Shown once on an empty shelf
 * (src/lib/tutorial.ts) and from Settings; the shelf itself stays one line of text.
 */
export default function TutorialDialog() {
  const { t } = useT();
  const open = useTutorial((state) => state.open);
  const hide = useTutorial((state) => state.hide);
  const [step, setStep] = useState(0);
  const starters = useStarterBooks();
  const last = step === STEPS.length - 1;
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const go = (next: number) => setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
  const seeSeries = () => {
    hide();
    useDiscoverIntent.getState().openSeries(STARTER_SERIES);
    navigate({ kind: "discover", category: "novel" });
  };
  const lookAround = () => {
    hide();
    navigate({ kind: "discover" });
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : hide())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content
          className="anim-pop fixed top-1/2 left-1/2 z-50 grid outline-none max-h-[calc(100dvh-1.5rem)] w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-3xl border border-line bg-card p-5 text-ink shadow-pop"
          data-tutorial
          data-tutorial-step={step}
          // Focus the dialog itself, not "Skip": a ring around Skip read as the thing to press.
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
          <div className="flex items-center justify-between gap-2">
            <Dialog.Title className="text-sm font-semibold text-muted">{t("tutorial.title")}</Dialog.Title>
            <button
              type="button"
              className="-mr-2 inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted hover:text-ink"
              onClick={hide}
              data-tutorial-skip
            >
              {last ? <X className="size-4" aria-hidden /> : null}
              {last ? t("common.close") : t("tutorial.skip")}
            </button>
          </div>

          <div className="grid aspect-[8/5] place-items-center overflow-hidden rounded-2xl bg-paper" data-tutorial-art>
            {step === 0 ? <ArtWordList label={t(STEPS[0].title)} tag={t("tutorial.tagList")} /> : null}
            {step === 1 ? <ArtDiscover label={t(STEPS[1].title)} tag={t("tutorial.tagAdded")} /> : null}
            {step === 2 ? <ArtEpub label={t(STEPS[2].title)} tag={t("tutorial.tagMatched")} /> : null}
            {step === 3 ? <ArtTapWord label={t(STEPS[3].title)} /> : null}
            {step === 4 ? (
              <div className="tut-art flex h-full w-full items-end justify-center gap-0 px-6 pb-3" data-tutorial-starters>
                {(starters.length ? starters : [null, null, null]).map((book, index) => (
                  <div
                    key={book?.id ?? index}
                    className={cn("w-[28%] shrink-0", index === 1 ? "z-[1] -mx-3 mb-3 w-[32%]" : "opacity-95")}
                    style={{ transform: `rotate(${(index - 1) * 6}deg)` }}
                  >
                    <div className="tut-float" style={{ animationDelay: `${index * 0.35}s` }}>
                      {book ? (
                        <BookCover title={book.title} author={book.author} cover={book.cover || undefined} />
                      ) : (
                        <div className="aspect-cover w-full rounded-md bg-line" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid gap-1.5" aria-live="polite">
            <h2 className="font-display text-xl font-semibold leading-snug" data-tutorial-heading>
              {t(STEPS[step].title)}
            </h2>
            <p className="text-sm leading-relaxed text-muted">{t(STEPS[step].body)}</p>
          </div>

          <div className="flex items-center justify-center gap-2" role="tablist" aria-label={t("tutorial.title")}>
            {STEPS.map((item, index) => (
              <button
                key={item.title}
                type="button"
                role="tab"
                aria-selected={index === step}
                aria-label={t("tutorial.step", { n: index + 1, total: STEPS.length })}
                onClick={() => go(index)}
                className="grid size-6 place-items-center"
              >
                <span className={cn("h-1.5 rounded-full transition-all", index === step ? "w-5 bg-accent" : "w-1.5 bg-line")} />
              </button>
            ))}
          </div>

          {last ? (
            <div className="grid gap-2">
              <button type="button" className={cn(btn.primary, "min-h-11 w-full")} onClick={seeSeries} data-tutorial-series>
                {t("tutorial.s5Go")}
              </button>
              <button type="button" className={cn(btn.quiet, "min-h-11 w-full")} onClick={lookAround} data-tutorial-discover>
                {t("tutorial.s5Later")}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={cn(btn.quiet, "min-h-11", step === 0 && "invisible")}
                onClick={() => go(step - 1)}
                data-tutorial-back
              >
                <ChevronLeft className="size-4" aria-hidden />
                {t("tutorial.back")}
              </button>
              <button type="button" className={cn(btn.primary, "min-h-11")} onClick={() => go(step + 1)} data-tutorial-next>
                {t("tutorial.next")}
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
          )}
          <Dialog.Description className="sr-only">{t(STEPS[step].body)}</Dialog.Description>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
