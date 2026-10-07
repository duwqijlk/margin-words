import * as Popover from "@radix-ui/react-popover";
import { BookOpen, Check, Loader2, Plus, RotateCw, Trash2, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
import { ConfirmDialog, cn } from "@/components/ui";
import { useT, type Key } from "@/lib/i18n";
import { listUpdatedParts } from "@/lib/list-updated";
import { forgetBook, useShelfRemove } from "@/lib/shelf-remove";

export type ShelfState = "off" | "busy" | "on" | "update" | "error";

const MONTH_KEY = [
  "discover.month.1",
  "discover.month.2",
  "discover.month.3",
  "discover.month.4",
  "discover.month.5",
  "discover.month.6",
  "discover.month.7",
  "discover.month.8",
  "discover.month.9",
  "discover.month.10",
  "discover.month.11",
  "discover.month.12",
] as const satisfies readonly Key[];

/** The line under a Discover card: the word list's last update, or what the add is doing right now. */
export function ShelfCardStatus({
  state,
  fraction,
  error = "",
  note = "",
  updated = "",
}: {
  state: ShelfState;
  fraction?: number;
  error?: string;
  note?: string;
  /** A day (`YYYY-MM-DD`) or an instant with a clock time. Empty when this list has no date. */
  updated?: string;
}) {
  const { t } = useT();
  const pct = fraction == null ? null : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  if (state === "busy") {
    return (
      <p className="text-xs leading-4 text-muted" data-list-status="busy">
        {pct != null && pct > 0 ? t("discover.workingPct", { pct }) : t("discover.working")}
      </p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="line-clamp-3 text-xs leading-4 font-medium text-warn">
        {error}
      </p>
    );
  }
  if (note) {
    return (
      <p data-list-note="" className="line-clamp-3 text-xs leading-4 text-muted">
        {note}
      </p>
    );
  }
  const clock = listUpdatedParts(updated);
  if (!clock) return null;
  const month = t(MONTH_KEY[clock.month - 1]);
  const label =
    "hour" in clock
      ? t("discover.updatedAt", {
          day: clock.day,
          month,
          year: clock.year,
          hour: clock.hour,
          minute: clock.minute,
        })
      : t("discover.updated", { day: clock.day, month, year: clock.year });
  return (
    <p className="text-xs leading-4 text-muted" data-list-updated={updated}>
      {label}
    </p>
  );
}

/**
 * The control that puts a book on the shelf and takes it off again. On Discover it sits on the
 * cover, as a plus, so the card can show the word list's date instead of a full-width button.
 *   plus  ->  spinner  ->  check (a small menu: open the book, or remove it).
 * "update" is the fallback for a word-list update that was not applied by itself. A signed-out
 * visitor's plus says "Sign in to add"; the tap opens the sign-in dialog.
 * It is one button the whole time, so keyboard focus stays on it while the state changes.
 */
export function AddToShelfButton({
  state,
  fraction,
  error = "",
  note = "",
  title,
  signedOut = false,
  onAdd,
  onOpen,
  onRemove,
}: {
  state: ShelfState;
  /** 0..1 while a public-domain book downloads. Omitted for a word list, which has no byte count. */
  fraction?: number;
  error?: string;
  /** Quiet line under the button. A hand-edited list uses it instead of an Update button. */
  note?: string;
  title: string;
  /** true when the visitor must sign in before adding; the "off" button then says so */
  signedOut?: boolean;
  onAdd: () => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const pct = fraction == null ? null : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  const needsSignIn = signedOut && (state === "off" || state === "error");
  const label =
    state === "on"
      ? t("discover.onShelf")
      : state === "busy"
        ? pct != null && pct > 0
          ? t("discover.workingPct", { pct })
          : t("discover.working")
        : state === "update"
          ? t("pack.update")
          : state === "error"
            ? needsSignIn
              ? t("discover.signInToAdd")
              : t("discover.retry")
            : needsSignIn
              ? t("discover.signInToAdd")
              : t("discover.add");
  const Icon =
    state === "on" ? Check : state === "busy" ? Loader2 : state === "update" || state === "error" ? RotateCw : Plus;
  return (
    <Popover.Root open={state === "on" && open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <button
          ref={button}
          type="button"
          data-shelf-add=""
          data-shelf-state={state}
          data-requires-signin={needsSignIn ? "" : undefined}
          aria-label={`${label}: ${title}`}
          aria-busy={state === "busy" || undefined}
          aria-disabled={state === "busy" || undefined}
          aria-haspopup={state === "on" ? "dialog" : undefined}
          aria-expanded={state === "on" ? open : undefined}
          className={cn(
            "shelf-add relative inline-flex size-11 items-center justify-center rounded-full border shadow-pop transition-colors",
            (state === "off" || state === "update") && "border-line bg-paper/95 text-accent hover:bg-accent-soft",
            state === "on" && "border-transparent bg-accent text-accent-ink hover:opacity-90",
            state === "busy" && "cursor-progress border-line bg-paper/95 text-muted",
            state === "error" && "border-warn bg-warn-soft text-warn hover:opacity-90",
          )}
          onClick={() => {
            if (state === "off" || state === "update" || state === "error") onAdd();
            else if (state === "on") setOpen((value) => !value);
          }}
        >
          <Icon
            key={state}
            className={cn("size-5", state === "busy" && "animate-spin", state === "on" && "shelf-check")}
            strokeWidth={state === "on" ? 2.75 : 2.25}
            aria-hidden
          />
          {state === "busy" ? (
            <span
              className="sr-only"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct ?? 0}
              aria-label={t("pack.progressFor", { title })}
            />
          ) : null}
        </button>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            button.current?.focus();
          }}
          className="anim-pop z-50 grid min-w-48 gap-0.5 rounded-xl border border-line bg-card p-1.5 text-ink shadow-pop"
        >
            <button
              type="button"
              className="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium hover:bg-accent-soft"
              onClick={() => {
                setOpen(false);
                onOpen();
              }}
            >
              <BookOpen className="size-4" aria-hidden />
              {t("discover.openBook")}
            </button>
            <button
              type="button"
              data-shelf-remove=""
              className="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium text-warn hover:bg-warn-soft"
              onClick={() => {
                setOpen(false);
                onRemove();
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              {t("discover.remove")}
            </button>
          </Popover.Content>
        </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Messages at the bottom of the screen, and the confirm step. Rendered once, so they stay up when the
 * screen changes. "Removed" has an Undo until the book is really deleted. "Added" says where the book went.
 */
export function ShelfToastHost({
  onViewShelf,
  aboveTabs = false,
}: {
  onViewShelf: () => void;
  /** True on a phone when the bottom tab bar is showing. */
  aboveTabs?: boolean;
}) {
  const { t, tn } = useT();
  const pending = useShelfRemove((state) => state.pending);
  const notice = useShelfRemove((state) => state.notice);
  const confirm = useShelfRemove((state) => state.confirm);
  const undo = useShelfRemove((state) => state.undo);
  const cancel = useShelfRemove((state) => state.cancel);
  const dismissNotice = useShelfRemove((state) => state.dismissNotice);
  const shell = cn(
    "toast-in fixed inset-x-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink py-2.5 pr-2.5 pl-4 text-sm font-medium text-paper shadow-pop",
    aboveTabs ? "bottom-[calc(4.75rem+env(safe-area-inset-bottom))] sm:bottom-4" : "bottom-[calc(1rem+env(safe-area-inset-bottom))]",
  );
  const action =
    "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 font-semibold text-accent-soft hover:bg-paper/15";
  return (
    <>
      {pending ? (
        <div data-undo-toast role="status" className={shell}>
          <Trash2 className="size-4 shrink-0 opacity-80" aria-hidden />
          <p className="min-w-0 flex-1 leading-snug">{t("discover.removed", { title: pending.title })}</p>
          <button type="button" className={action} onClick={undo}>
            <Undo2 className="size-4" aria-hidden />
            {t("discover.undo")}
          </button>
        </div>
      ) : notice ? (
        <div data-added-toast key={notice.id} role="status" className={shell}>
          <Check className="size-4 shrink-0 text-accent-soft" strokeWidth={3} aria-hidden />
          <p className="min-w-0 flex-1 leading-snug">{t("discover.added", { title: notice.title })}</p>
          <button
            type="button"
            className={action}
            onClick={() => {
              dismissNotice();
              onViewShelf();
            }}
          >
            {t("discover.viewShelf")}
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) cancel();
        }}
        title={confirm ? t("discover.removeTitle", { title: confirm.book.title }) : t("discover.removeTitle", { title: "" })}
        description={
          confirm && confirm.words > 0
            ? t("discover.removeBodyWords", { words: tn("count.word", confirm.words) })
            : t("discover.removeBody")
        }
        confirmLabel={t("discover.removeConfirm")}
        onConfirm={() => {
          if (!confirm) return;
          const id = confirm.book.id;
          cancel();
          void forgetBook(id);
        }}
      />
    </>
  );
}
