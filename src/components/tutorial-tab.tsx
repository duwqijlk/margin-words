import { BookOpen, ChevronRight, Lightbulb, Quote, X } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { useT, type Key } from "@/lib/i18n";
import {
  openTutorial,
  TUTORIALS,
  useTutorialList,
  useTutorialsSeen,
  type TutorialId,
} from "@/lib/tutorial";
import { cn } from "@/components/ui";
import { useSheetDrag } from "@/components/floating-card";

const PHONE = "(max-width: 40rem)";

const ROWS: Record<TutorialId, { icon: ComponentType<{ className?: string }>; title: Key; body: Key }> = {
  start: { icon: BookOpen, title: "tuttab.start", body: "tuttab.startBody" },
  tip: { icon: Lightbulb, title: "tuttab.tip", body: "tuttab.tipBody" },
  quotes: { icon: Quote, title: "tuttab.quotes", body: "tuttab.quotesBody" },
};

function useMedia(query: string): boolean {
  const read = () => typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [on, setOn] = useState(read);
  useEffect(() => {
    const onResize = () => setOn(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  return on;
}

/**
 * The list of every tutorial (design system TutorialTab): icon, name, one line, how long. Beside the
 * tab when opened from it; from Settings a bottom sheet on a phone and a small window elsewhere.
 * A row closes the list and opens that tutorial over the page.
 */
export function TutorialList() {
  const { t } = useT();
  const from = useTutorialList((state) => state.open);
  const hide = useTutorialList((state) => state.hide);
  const seen = useTutorialsSeen((state) => state.seen);
  const phone = useMedia(PHONE);
  const box = useRef<HTMLDivElement | null>(null);
  // On a phone the list is a bottom sheet that follows the finger (design system SpringSheet).
  useSheetDrag(box, hide, PHONE, from === "center" && phone);

  useEffect(() => {
    if (!from) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || box.current?.contains(target)) return;
      if (from === "tab" && document.querySelector("[data-tutorial-tab]")?.contains(target)) return;
      hide();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    box.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [from, hide]);

  if (!from) return null;
  const sheet = from === "center" && phone;
  const beside = from === "tab";
  const tabBox = beside ? document.querySelector("[data-tutorial-tab]")?.getBoundingClientRect() : undefined;
  const top = tabBox ? Math.min(Math.max(tabBox.top + tabBox.height / 2, 180), window.innerHeight - 180) : undefined;

  return (
    <>
      {beside ? null : <div className="fixed inset-0 z-[41] bg-black/[0.32]" aria-hidden />}
      <div
        ref={box}
        role="dialog"
        aria-label={t("tuttab.title")}
        tabIndex={-1}
        className={cn(
          "grid gap-0.5 border border-float-edge bg-float p-2 text-ink shadow-pop outline-none",
          sheet
            ? "tut-sheet fixed inset-x-0 bottom-0 z-[42] rounded-t-2xl pb-[calc(16px+env(safe-area-inset-bottom))]"
            : beside
              ? "tut-panel fixed right-[50px] z-[41] w-80 rounded-2xl pb-3"
              : "anim-pop fixed top-1/2 left-1/2 z-[42] w-[min(20rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl pb-3",
        )}
        style={beside ? { top } : undefined}
        data-tut-panel={sheet ? "sheet" : beside ? "tab" : "center"}
      >
        <header className="flex items-center justify-between py-1 pr-1 pl-3">
          <h3 className="m-0 text-base font-bold">{t("tuttab.title")}</h3>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded text-muted hover:bg-sheet hover:text-ink"
            onClick={hide}
            aria-label={t("common.close")}
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>
        {TUTORIALS.map((id) => {
          const row = ROWS[id];
          const Icon = row.icon;
          return (
            <button
              key={id}
              type="button"
              className="grid min-h-[60px] grid-cols-[36px_minmax(0,1fr)_16px] items-center gap-3 rounded px-2.5 py-2 text-left text-ink hover:bg-sheet focus-visible:bg-sheet"
              onClick={() => {
                hide();
                openTutorial(id);
              }}
              data-tutorial-row={id}
            >
              <span className="grid size-9 place-items-center rounded bg-accent-soft text-accent">
                <Icon className="size-[18px]" aria-hidden />
              </span>
              <span className="min-w-0">
                <b className="flex items-center gap-1.5 text-[15px]">
                  {t(row.title)}
                  {!seen[id] ? <NewTag /> : null}
                </b>
                <em className="mt-0.5 block text-xs leading-[1.45] text-faint not-italic">{t(row.body)}</em>
              </span>
              <ChevronRight className="size-4 text-faint" aria-hidden />
            </button>
          );
        })}
        <p className="mx-2.5 mt-1.5 mb-0 text-xs leading-normal text-faint">{t("tuttab.foot")}</p>
      </div>
    </>
  );
}

/** "New" on a tutorial not seen yet (the list, the Settings row). */
export function NewTag() {
  const { t } = useT();
  return (
    <i className="rounded-full bg-accent px-1.5 text-xs leading-[1.4] font-bold text-accent-ink not-italic" data-tutorial-new>
      {t("tuttab.new")}
    </i>
  );
}
