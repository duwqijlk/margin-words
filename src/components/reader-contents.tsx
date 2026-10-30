import * as Dialog from "@radix-ui/react-dialog";
import { List, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { btn, cn, field } from "@/components/ui";

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
  const q = query.trim().toLowerCase();

  useEffect(() => {
    if (open) currentRef.current?.scrollIntoView({ block: "center" });
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className={btn.icon} aria-label={t("contents.title")}>
        <List className="size-5" aria-hidden />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/[0.32]" />
        <Dialog.Content className="anim-drawer fixed inset-y-0 left-0 z-50 flex w-[min(24rem,88vw)] flex-col border-r border-float-edge bg-float text-ink shadow-lift ">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
            <Dialog.Title className="font-bold tracking-[-0.02em] text-lg">
              {t("contents.title")}
            </Dialog.Title>
            <Dialog.Description className="sr-only">{t("contents.desc")}</Dialog.Description>
            <Dialog.Close className={btn.icon} aria-label={t("contents.close")}>
              <X className="size-5" aria-hidden />
            </Dialog.Close>
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
          <ol className="scroll-thin flex-1 overflow-y-auto p-2">
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
