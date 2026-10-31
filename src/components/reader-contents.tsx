import { FocusScope } from "@radix-ui/react-focus-scope";
import { hideOthers } from "aria-hidden";
import { List, Search, X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { RemoveScroll } from "react-remove-scroll";
import { useT } from "@/lib/i18n";
import { btn, cn, field } from "@/components/ui";

/** Keep the reader's scrollbar and inherited styles unchanged, even for a very long chapter. */
function ContentsModal({
  id,
  titleId,
  descriptionId,
  trigger,
  list,
  current,
  onClose,
  children,
}: {
  id: string;
  titleId: string;
  descriptionId: string;
  trigger: RefObject<HTMLButtonElement | null>;
  list: RefObject<HTMLOListElement | null>;
  current: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const backdropDown = useRef(false);
  useLayoutEffect(() => {
    const content = panel.current;
    if (!content) return;
    const left = window.scrollX;
    const top = window.scrollY;
    // Keep the scrollbar visible (no reflow), but do not let dragging it move the book.
    const holdPage = () => {
      if (window.scrollX !== left || window.scrollY !== top) window.scrollTo(left, top);
    };
    window.addEventListener("scroll", holdPage);
    let undo = hideOthers(content);
    // A toast or another body sibling can mount while the directory is open.
    const observer = new MutationObserver(() => {
      const next = hideOthers(content);
      undo();
      undo = next;
    });
    observer.observe(document.body, { childList: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", holdPage);
      undo();
    };
  }, []);
  useLayoutEffect(() => {
    const row = current.current;
    const scroller = list.current;
    if (!row || !scroller) return;
    const rowBox = row.getBoundingClientRect();
    const listBox = scroller.getBoundingClientRect();
    scroller.scrollTop += rowBox.top - listBox.top - (scroller.clientHeight - rowBox.height) / 2;
  }, [current, list]);

  return createPortal(
    <RemoveScroll forwardProps removeScrollBar={false} inert={false} allowPinchZoom>
      <div
        data-reader-contents-layer
        className="fixed inset-0 z-50"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          data-contents-backdrop
          className="absolute inset-0 bg-black/[0.32]"
          onPointerDown={(event) => {
            backdropDown.current = event.button === 0;
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget && backdropDown.current) onClose();
            backdropDown.current = false;
          }}
        />
        <FocusScope
          asChild
          trapped
          loop
          onMountAutoFocus={(event) => {
            event.preventDefault();
            panel.current?.focus({ preventScroll: true });
          }}
          onUnmountAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
          }}
        >
          <div
            ref={panel}
            id={id}
            data-reader-contents
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
              }
            }}
            className="anim-drawer fixed inset-y-0 left-0 z-50 flex w-[min(24rem,88vw)] flex-col border-r border-float-edge bg-float text-ink shadow-lift"
          >
            {children}
          </div>
        </FocusScope>
      </div>
    </RemoveScroll>,
    document.body,
  );
}

export function ReaderContents({
  chapters,
  current,
  onPick,
  rows,
  onPickRow,
}: {
  chapters: Array<{ title: string }>;
  current: number;
  onPick: (index: number) => void;
  rows?: Array<{ key: string; mark: string; title: string; active: boolean }>;
  onPickRow?: (key: string) => void;
}) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const currentRef = useRef<HTMLButtonElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLOListElement | null>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const q = query.trim().toLowerCase();

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={btn.icon}
        aria-label={t("contents.title")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(true)}
      >
        <List className="size-5" aria-hidden />
      </button>
      {open ? (
        <ContentsModal
          id={id}
          titleId={titleId}
          descriptionId={descriptionId}
          trigger={trigger}
          list={list}
          current={currentRef}
          onClose={() => setOpen(false)}
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
            <h2 id={titleId} className="font-bold tracking-[-0.02em] text-lg">
              {t("contents.title")}
            </h2>
            <p id={descriptionId} className="sr-only">
              {t("contents.desc")}
            </p>
            <button
              type="button"
              className={btn.icon}
              aria-label={t("contents.close")}
              onClick={() => setOpen(false)}
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          {(rows ? rows.length : chapters.length) > 12 ? (
            <div className="border-b border-line p-3">
              <label className="relative block">
                <span className="sr-only">{t("contents.search")}</span>
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                  aria-hidden
                />
                <input
                  className={cn(field, "pl-9")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("contents.search")}
                  type="search"
                />
              </label>
            </div>
          ) : null}
          <ol
            ref={list}
            className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
          >
            {rows
              ? rows.map((row) => {
                  if (q && !row.title.toLowerCase().includes(q)) return null;
                  return (
                    <li key={row.key}>
                      <button
                        type="button"
                        ref={row.active ? currentRef : undefined}
                        aria-current={row.active ? "true" : undefined}
                        onClick={() => {
                          onPickRow?.(row.key);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex min-h-11 w-full items-baseline gap-3 rounded-lg px-3 py-2 text-left text-[0.95rem] leading-snug transition-colors",
                          row.active
                            ? "bg-accent-soft font-semibold text-accent"
                            : "hover:bg-accent-soft/60",
                        )}
                      >
                        <span
                          className={cn(
                            "shrink-0 text-right text-xs text-muted",
                            row.mark.length > 2 ? "w-12" : "w-7 tabular-nums",
                          )}
                        >
                          {row.mark}
                        </span>
                        <span className="min-w-0 flex-1" lang="en">
                          {row.title}
                        </span>
                      </button>
                    </li>
                  );
                })
              : null}
            {rows
              ? null
              : chapters.map((chapter, index) => {
                  if (q && !chapter.title.toLowerCase().includes(q)) return null;
                  const active = index === current;
                  return (
                    <li key={`${chapter.title}-${index}`}>
                      <button
                        type="button"
                        ref={active ? currentRef : undefined}
                        aria-current={active ? "true" : undefined}
                        onClick={() => {
                          onPick(index);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex min-h-11 w-full items-baseline gap-3 rounded-lg px-3 py-2 text-left text-[0.95rem] leading-snug transition-colors",
                          active
                            ? "bg-accent-soft font-semibold text-accent"
                            : "hover:bg-accent-soft/60",
                        )}
                      >
                        <span className="w-7 shrink-0 text-right text-xs tabular-nums text-muted">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1" lang="en">
                          {chapter.title}
                        </span>
                      </button>
                    </li>
                  );
                })}
          </ol>
        </ContentsModal>
      ) : null}
    </>
  );
}
