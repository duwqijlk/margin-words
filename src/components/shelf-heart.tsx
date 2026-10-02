import { Heart, Loader2, RotateCw } from "lucide-react";
import { ConfirmDialog, btn, cn } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { forgetBook, useShelfRemove } from "@/lib/shelf-remove";

/**
 * Heart on the top-right of a cover. Outline: not on the shelf. Filled red: on the shelf.
 * A light circle sits behind it so the icon stays clear on any cover.
 */
export function ShelfHeart({
  pressed,
  busy = false,
  fraction,
  error = "",
  title,
  onClick,
}: {
  pressed: boolean;
  busy?: boolean;
  /** 0..1 while a classic is downloading. Omitted for a word list, which has no byte count yet. */
  fraction?: number;
  error?: string;
  title: string;
  onClick: () => void;
}) {
  const { t } = useT();
  const label = error
    ? t("discover.retryAria", { title })
    : busy
      ? t("discover.heartAdding", { title })
      : pressed
        ? t("discover.removeAria", { title })
        : t("discover.addAria", { title });
  const pct =
    fraction == null ? null : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <>
      <button
        type="button"
        className="shelf-heart absolute top-1 right-1 z-10 inline-flex size-11 items-center justify-center rounded-full disabled:opacity-100"
        style={
          busy && pct != null
            ? { background: `conic-gradient(var(--accent) ${pct}%, rgb(255 255 255 / 0.45) 0)` }
            : undefined
        }
        aria-pressed={pressed}
        aria-busy={busy || undefined}
        aria-invalid={error ? true : undefined}
        aria-label={label}
        disabled={busy}
        data-shelf-heart=""
        data-heart-state={error ? "error" : busy ? "busy" : pressed ? "on" : "off"}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      >
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-black/20",
            busy && "ring-2 ring-[#28604f]",
          )}
        >
          {busy ? (
            pct != null && pct > 0 ? (
              <span className="text-[0.7rem] leading-none font-bold tabular-nums text-[#28604f]" aria-hidden>
                {pct}
              </span>
            ) : (
              <Loader2 className="size-5 animate-spin text-[#28604f]" aria-hidden />
            )
          ) : error ? (
            <RotateCw className="size-4 text-[#9a3412]" aria-hidden />
          ) : (
            <Heart
              key={pressed ? "on" : "off"}
              className={cn("size-[1.15rem]", pressed ? "heart-icon fill-[#b91c1c] text-[#b91c1c]" : "fill-none text-[#3f3a33]")}
              strokeWidth={2.25}
              aria-hidden
            />
          )}
        </span>
        {busy ? (
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
      {error ? (
        <p
          role="alert"
          className="pointer-events-none absolute inset-x-2 bottom-2 z-10 line-clamp-3 rounded-lg bg-white/95 px-2 py-1 text-left text-xs leading-4 font-semibold text-[#9a3412] shadow-md"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}

/** Undo toast and the confirm step. Rendered once, so it stays up when the screen changes. */
export function ShelfRemoveHost() {
  const { t } = useT();
  const pending = useShelfRemove((state) => state.pending);
  const confirm = useShelfRemove((state) => state.confirm);
  const undo = useShelfRemove((state) => state.undo);
  const cancel = useShelfRemove((state) => state.cancel);
  return (
    <>
      {pending ? (
        <div
          data-undo-toast
          role="status"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-sm text-ink shadow-pop"
        >
          <p className="min-w-0">{t("discover.removed", { title: pending.title })}</p>
          <button type="button" className={cn(btn.primary, "shrink-0 px-3")} onClick={undo}>
            {t("discover.undo")}
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) cancel();
        }}
        title={confirm ? t("discover.removeTitle", { title: confirm.book.title }) : t("discover.removeTitle", { title: "" })}
        description={t("discover.removeBody", { n: confirm?.words ?? 0 })}
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
