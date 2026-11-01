import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, BookmarkCheck, Copy, Quote, TextCursor, Type } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useT, type Key } from "@/lib/i18n";
import { useQuoteTip } from "@/lib/tutorial";
import { btn, cn } from "@/components/ui";

type Kind = "desk" | "phone";

const STEPS: Record<Kind, Key[]> = {
  desk: ["qf.desk1", "qf.desk2", "qf.desk3", "qf.desk4", "qf.desk5"],
  phone: ["qf.phone1", "qf.phone2", "qf.phone3", "qf.phone4", "qf.phone5"],
};

/** Book text of the little page (book content stays English). */
const LEAD = "And I feel ordinary. Inside. ";
const WORDS = "But I know ordinary kids don't make other ordinary kids run away screaming in playgrounds.".split(" ");
const NEXT = "I tried to tune in to what Mom was saying, but my mind kept drifting back to the bus.";
const SENTENCES = [
  "And I feel ordinary.",
  "Inside.",
  "But I know ordinary kids don't make other ordinary kids run away screaming in playgrounds.",
  "If I found a magic lamp and I could have one wish, I would wish that I had a normal face.",
];

/**
 * A finger, not a mouse: phones and tablets. Decided by the way the device points, not by the
 * screen width: a tablet is wide, but a long press there fights the system's own selection too.
 */
function touchDevice(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

function reducedMotion(): boolean {
  return (
    (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
    document.documentElement.getAttribute("data-theme") === "eink"
  );
}

type Scene = {
  step: number;
  ptr: { x: number; y: number; on: boolean; down: boolean; ms: number };
  /** Words dragged over so far (desk). */
  drag: number;
  sel: boolean;
  bar: { left: number; top: number } | null;
  saved: boolean;
  toast: boolean;
  menu: boolean;
  hover: "keep" | "quotes" | null;
  picking: boolean;
  picked: number[];
  ripple: { id: number; x: number; y: number } | null;
};

const START: Scene = {
  step: -1,
  ptr: { x: 0, y: 0, on: false, down: false, ms: 0 },
  drag: 0,
  sel: false,
  bar: null,
  saved: false,
  toast: false,
  menu: false,
  hover: null,
  picking: false,
  picked: [],
  ripple: null,
};

class Stop extends Error {}

/**
 * The looping demo: a small reading page acting out the steps, about 12 seconds a round. Paused
 * while the tab is hidden; stopped when the window closes. Nothing here is a real control.
 */
function useScene(kind: Kind, stage: RefObject<HTMLDivElement | null>, run: boolean) {
  const [scene, setScene] = useState<Scene>(START);
  useEffect(() => {
    if (!run) return;
    let alive = true;
    let ripples = 0;
    const patch = (next: Partial<Scene>) => alive && setScene((now) => ({ ...now, ...next }));
    const wait = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        let left = ms;
        let last = Date.now();
        const tick = () => {
          if (!alive) return reject(new Stop());
          const now = Date.now();
          if (!document.hidden) left -= now - last;
          last = now;
          if (left <= 0) resolve();
          else window.setTimeout(tick, Math.min(60, left));
        };
        tick();
      });
    const el = (selector: string, index = 0) => stage.current?.querySelectorAll<HTMLElement>(selector)[index] ?? null;
    const at = (target: HTMLElement | null, fx = 0.5, fy = 0.5) => {
      const box = stage.current?.getBoundingClientRect();
      const rect = target?.getClientRects()[0] ?? target?.getBoundingClientRect();
      if (!box || !rect) return { x: 0, y: 0 };
      return { x: rect.left - box.left + rect.width * fx, y: rect.top - box.top + rect.height * fy };
    };
    let ptr = START.ptr;
    const setPtr = (next: Partial<Scene["ptr"]>) => {
      ptr = { ...ptr, ...next };
      patch({ ptr });
    };
    const move = async (target: { x: number; y: number }, ms: number) => {
      setPtr({ ...target, ms, on: true });
      await wait(ms + 40);
    };
    const press = async () => {
      ripples += 1;
      setPtr({ down: true });
      patch({ ripple: { id: ripples, x: ptr.x, y: ptr.y } });
      await wait(170);
      setPtr({ down: false });
      await wait(140);
    };
    const tap = async (target: HTMLElement | null) => {
      setPtr({ ...at(target), ms: 0, on: true });
      await wait(180);
      await press();
      setPtr({ on: false });
      await wait(120);
    };

    const desk = async () => {
      await wait(300);
      patch({ step: 0 });
      const box = stage.current;
      setPtr({ x: (box?.clientWidth ?? 300) - 50, y: (box?.clientHeight ?? 200) - 30, ms: 0, on: true });
      await wait(60);
      await move(at(el("[data-qf-w]", 2), 0, 0.55), 800);
      setPtr({ down: true });
      for (let i = 2; i <= 7; i += 1) {
        patch({ drag: i - 1 });
        await move(at(el("[data-qf-w]", i), 1, 0.55), 170);
      }
      await wait(300);
      setPtr({ down: false });
      patch({ step: 1, drag: 0, sel: true });
      await wait(1000);
      const first = el("[data-qf-w]", 0);
      const frame = box?.getBoundingClientRect();
      const rect = first?.getBoundingClientRect();
      const bar = el("[data-qf-bar]");
      const half = (bar?.offsetWidth ?? 180) / 2;
      if (frame && rect)
        patch({
          step: 2,
          bar: {
            left: Math.min(Math.max(rect.left - frame.left + 60, half + 8), (box?.clientWidth ?? 300) - half - 8),
            top: rect.top - frame.top - 12,
          },
        });
      await wait(500);
      await move(at(el("[data-qf-keep]")), 700);
      patch({ hover: "keep" });
      await wait(500);
      await press();
      patch({ step: 3, bar: null, hover: null, sel: false, saved: true, toast: true });
      await wait(1800);
      patch({ step: 4, toast: false });
      await move(at(el("[data-qf-save]")), 800);
      await press();
      patch({ menu: true });
      await wait(450);
      await move(at(el("[data-qf-item]", 1), 0.4), 550);
      patch({ hover: "quotes" });
      await wait(1600);
    };

    const phone = async () => {
      await wait(400);
      patch({ step: 0 });
      await tap(el("[data-qf-save]"));
      patch({ menu: true });
      await wait(900);
      patch({ step: 1 });
      await tap(el("[data-qf-item]", 2));
      patch({ menu: false, picking: true });
      await wait(1100);
      patch({ step: 2 });
      await tap(el("[data-qf-s]", 2));
      patch({ picked: [2] });
      await wait(700);
      await tap(el("[data-qf-s]", 3));
      patch({ picked: [2, 3] });
      await wait(1000);
      patch({ step: 3 });
      await tap(el("[data-qf-pick-save]"));
      patch({ picking: false, picked: [], saved: true, toast: true });
      await wait(1800);
      patch({ step: 4, toast: false });
      await tap(el("[data-qf-save]"));
      patch({ menu: true, hover: "quotes" });
      await wait(1600);
    };

    void (async () => {
      try {
        for (;;) {
          ptr = START.ptr;
          setScene(START);
          await wait(60);
          await (kind === "desk" ? desk() : phone());
          await wait(900);
        }
      } catch {
        // Stopped: the window closed.
      }
    })();
    return () => {
      alive = false;
    };
  }, [kind, stage, run]);
  return scene;
}

/**
 * How to keep a sentence (design system QuoteFlow): a normal dialog with a tag, a short looping
 * demo for this device's way of selecting (a mouse drags and the selection snaps to the sentence;
 * a finger uses the bookmark's pick mode), a caption with the step and dots, and one button. Shown
 * once over the book (src/lib/tutorial.ts) and again from the tutorial tab.
 */
export default function QuoteFlowDialog() {
  const { t, tn } = useT();
  const open = useQuoteTip((state) => state.open);
  const hide = useQuoteTip((state) => state.hide);
  const [kind] = useState<Kind>(() => (touchDevice() ? "phone" : "desk"));
  const [still] = useState(reducedMotion);
  const stage = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const scene = useScene(kind, stage, open && ready && !still);
  const steps = STEPS[kind];
  const shown = still ? steps.length - 1 : scene.step;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : hide())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/[0.32]" />
        <Dialog.Content
          className="anim-pop fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-1.5rem)] w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-float-edge bg-float px-[22px] pt-[22px] pb-5 text-ink shadow-lift outline-none"
          data-quote-flow={kind}
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
            setReady(true);
          }}
        >
          <span className="mb-2 justify-self-start rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-bold text-accent">{t("qf.tag")}</span>
          <Dialog.Title className="m-0 text-[21px] leading-snug font-bold tracking-[-0.02em]">{t("qf.title")}</Dialog.Title>
          <Dialog.Description className="mt-1.5 mb-0 text-sm leading-relaxed text-muted">{t("qf.body")}</Dialog.Description>

          <div
            ref={stage}
            aria-hidden
            className={cn(
              "relative mt-4 overflow-hidden rounded border border-line bg-paper select-none",
              kind === "phone" ? "h-[290px]" : "h-[250px]",
            )}
            data-quote-flow-stage
          >
            <Stage kind={kind} scene={scene} still={still} t={t} tn={tn} />
          </div>

          <div className="mt-2.5 flex min-h-11 items-center justify-between gap-3">
            <p className="m-0 text-sm leading-[1.45] text-ink" aria-live="polite" data-quote-flow-caption>
              {still ? (
                steps.map((key, index) => (
                  <span key={key} className="block">
                    <b className="mr-1.5 text-accent [font-variant-numeric:tabular-nums]">{index + 1}</b>
                    {t(key)}
                  </span>
                ))
              ) : shown >= 0 ? (
                <>
                  <b className="mr-1.5 text-accent [font-variant-numeric:tabular-nums]">{shown + 1}</b>
                  {t(steps[shown] ?? steps[0])}
                </>
              ) : (
                " "
              )}
            </p>
            {!still ? (
              <span className="flex shrink-0 gap-[5px]" aria-hidden>
                {steps.map((key, index) => (
                  <i
                    key={key}
                    className={cn("step-dot block h-1.5 rounded-full", index === shown ? "w-[18px] bg-accent" : "w-1.5 bg-line")}
                  />
                ))}
              </span>
            ) : null}
          </div>

          <button type="button" className={cn(btn.primary, "mt-3.5 w-full")} onClick={hide} data-quote-flow-ok>
            {t("qf.ok")}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The little reading page. Every part is drawn in the app's own look, scaled down. */
function Stage({
  kind,
  scene,
  still,
  t,
  tn,
}: {
  kind: Kind;
  scene: Scene;
  still: boolean;
  t: ReturnType<typeof useT>["t"];
  tn: ReturnType<typeof useT>["tn"];
}) {
  const wash = "rgb(var(--accent-rgb) / 0.22)";
  const icon = "inline-grid size-9 shrink-0 place-items-center rounded text-muted";
  const ptrStyle: CSSProperties = {
    left: scene.ptr.x,
    top: scene.ptr.y,
    transitionDuration: `${scene.ptr.ms}ms`,
  };
  return (
    <>
      <div className="flex h-11 items-center border-b border-line px-1">
        <span className={icon}>
          <ArrowLeft className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1 text-center leading-tight">
          <b className="block truncate font-display text-sm font-semibold">Wonder</b>
          <span className="block truncate text-[11px] text-faint">Ordinary</span>
        </span>
        <span className={icon}>
          <Type className="size-[18px]" />
        </span>
        <span
          className={cn(icon, (scene.menu || scene.picking) && "bg-accent-soft text-accent")}
          data-qf-save
        >
          <BookmarkCheck className="size-[18px]" />
        </span>
      </div>

      {scene.menu ? (
        <div className="anim-pop absolute top-[46px] right-1 z-10 grid w-[208px] rounded-2xl border border-float-edge bg-float p-1.5 text-ink shadow-pop">
          {[
            { icon: BookmarkCheck, label: t("save.words"), count: "1,284" },
            { icon: Quote, label: t("save.quotes"), count: "36" },
          ].map((item, index) => (
            <span
              key={item.label}
              className={cn(
                "grid min-h-10 grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold",
                index === 1 && scene.hover === "quotes" && "bg-sheet",
              )}
              data-qf-item
            >
              <item.icon className="size-[18px] text-accent" />
              {item.label}
              <small className="text-xs font-normal text-faint">{item.count}</small>
            </span>
          ))}
          <span className="mx-2 my-1 h-px bg-line" />
          <span className="grid min-h-10 grid-cols-[18px_minmax(0,1fr)] items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold" data-qf-item>
            <TextCursor className="size-[18px] text-accent" />
            <span className="grid leading-tight">
              {t("save.pick")}
              <em className="text-[11px] font-normal text-faint not-italic">{t("save.pickHint")}</em>
            </span>
          </span>
        </div>
      ) : null}

      <div className="px-[18px] pt-3.5 font-display text-[15px] leading-[1.7]" lang="en">
        {kind === "desk" ? (
          <>
            <p className="m-0 mb-[0.6em]">
              {LEAD}
              {WORDS.map((word, index) => {
                const dragged = scene.drag > 0 && index >= 2 && index < 2 + scene.drag;
                const lit = scene.sel || dragged || (still && index >= 0);
                return (
                  <span
                    key={index}
                    data-qf-w
                    className={cn("rounded-sm transition-colors duration-100", scene.saved && "qf-saved")}
                    style={lit ? { background: dragged && !scene.sel ? "rgb(var(--accent-rgb) / 0.14)" : wash } : undefined}
                  >
                    {word}
                    {index < WORDS.length - 1 ? " " : ""}
                  </span>
                );
              })}
            </p>
            <p className="m-0">{NEXT}</p>
          </>
        ) : (
          <>
            <p className="m-0 mb-[0.6em]">
              {SENTENCES.slice(0, 3).map((sentence, index) => (
                <span key={index}>
                  <span
                    data-qf-s
                    className={cn("rounded-sm", scene.saved && (index === 2) && "qf-saved")}
                    style={scene.picked.includes(index) ? { background: wash } : undefined}
                  >
                    {sentence}
                  </span>{" "}
                </span>
              ))}
            </p>
            <p className="m-0">
              <span
                data-qf-s
                className={cn("rounded-sm", scene.saved && "qf-saved")}
                style={scene.picked.includes(3) ? { background: wash } : undefined}
              >
                {SENTENCES[3]}
              </span>
            </p>
          </>
        )}
      </div>

      {kind === "desk" ? (
        <div
          data-qf-bar
          className={cn(
            "absolute z-10 flex -translate-x-1/2 -translate-y-full rounded-xl bg-ink p-1 whitespace-nowrap shadow-lift",
            scene.bar ? "anim-pop" : "invisible",
          )}
          style={scene.bar ? { left: scene.bar.left, top: scene.bar.top } : { left: 0, top: 0 }}
        >
          <span
            data-qf-keep
            className={cn("inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold text-mark-inverse", scene.hover === "keep" && "bg-paper/15")}
          >
            <Quote className="size-3.5" />
            {t("quote.keep")}
          </span>
          <span className="inline-flex min-h-[34px] items-center gap-1.5 px-2.5 text-xs font-bold text-paper shadow-[-1px_0_0_rgb(var(--paper-rgb)/0.16)]">
            <Copy className="size-3.5" />
            {t("quote.copy")}
          </span>
        </div>
      ) : scene.picking ? (
        <div className="absolute inset-x-0 bottom-0 z-10 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 border-t border-float-edge bg-float px-2.5 py-2 shadow-pop">
          <span className="text-[13px] text-muted">{scene.picked.length ? tn("quote.picked", scene.picked.length) : t("quote.pickHint")}</span>
          <span className="px-2 text-[13px] font-bold">{t("common.cancel")}</span>
          <span
            data-qf-pick-save
            className={cn("inline-flex min-h-[34px] items-center rounded bg-accent px-3 text-[13px] font-bold text-accent-ink", !scene.picked.length && "opacity-40")}
          >
            {t("quote.keepShort")}
          </span>
        </div>
      ) : null}

      {scene.toast ? (
        <div className="toast-in absolute bottom-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded bg-ink py-1.5 pr-1.5 pl-3 text-[13px] whitespace-nowrap text-paper shadow-lift">
          {t("quote.kept")}
          <span className="px-2 font-bold text-mark-inverse">{t("discover.undo")}</span>
        </div>
      ) : null}

      {scene.ripple ? (
        <i
          key={scene.ripple.id}
          className="qf-ripple pointer-events-none absolute z-[19] -mt-5 -ml-5 size-10 rounded-full bg-accent"
          style={{ left: scene.ripple.x, top: scene.ripple.y }}
        />
      ) : null}

      <div
        className={cn(
          "pointer-events-none absolute z-20 transition-[left,top,opacity,transform] ease-[cubic-bezier(.4,0,.2,1)]",
          scene.ptr.on ? "opacity-100" : "opacity-0",
        )}
        style={ptrStyle}
      >
        {kind === "desk" ? (
          <svg
            viewBox="0 0 24 24"
            className={cn("-mt-0.5 -ml-1 size-5 origin-[4px_2px] drop-shadow transition-transform", scene.ptr.down && "scale-[0.86]")}
          >
            <path d="M4 2l14 9-6.2 1.3L15 20l-2.6 1.2-3.3-7.5L4 18z" fill="#fff" stroke="#111" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        ) : (
          <span
            className={cn(
              "-mt-4 -ml-4 block size-8 rounded-full border-2 border-white/90 shadow-[0_2px_8px_rgb(0_0_0/0.25)] transition-transform",
              scene.ptr.down ? "scale-[0.78] bg-black/30" : "bg-black/20",
            )}
          />
        )}
      </div>
    </>
  );
}
