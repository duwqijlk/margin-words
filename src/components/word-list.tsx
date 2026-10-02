import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, FileJson, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { GlossaryCheck } from "@/lib/glossary-format";
import { errorText, trn, useT } from "@/lib/i18n";
import { guideUrl } from "@/lib/guide";
import {
  applyGlossary,
  planImport,
  type ImportMode,
  type ImportPlan,
  type ImportResult,
} from "@/lib/glossary-import";
import { btn, cn } from "@/components/ui";

/* ------------------------------------------------------------------ shared bits */

const panel =
  "anim-pop fixed top-1/2 left-1/2 z-50 flex max-h-[min(88dvh,46rem)] w-[min(38rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line bg-card text-ink shadow-pop";

function Frame({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useT();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <Dialog.Content className={panel}>
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 pt-4 pb-3">
            <div className="grid gap-0.5">
              <Dialog.Title className="font-display text-xl font-semibold">{title}</Dialog.Title>
              <Dialog.Description className="text-sm text-muted">{description}</Dialog.Description>
            </div>
            <Dialog.Close className={cn(btn.icon, "-mt-1 -mr-2")} aria-label={t("common.close")}>
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <div className="scroll-thin grid gap-4 overflow-y-auto px-5 py-4 text-[0.95rem]">
            {children}
          </div>
          {footer ? (
            <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ------------------------------------------------------------------ add a list */

export type ListFlow = {
  fileName: string;
  check: GlossaryCheck;
  /** the book the list is for; null = the person still has to choose */
  bookId: string | null;
  /** set when the list came together with a book that was not added (because the list has errors) */
  withBook?: string;
};

export function WordListDialog({
  flow,
  books,
  onClose,
  onPickAnother,
  onDone,
}: {
  flow: ListFlow | null;
  books: Array<{ id: string; title: string }>;
  onClose: () => void;
  onPickAnother: (bookId: string | null) => void;
  onDone: (bookId: string, result: ImportResult, notes: string[]) => void;
}) {
  const { t, tn } = useT();
  const [bookId, setBookId] = useState<string>("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [mode, setMode] = useState<ImportMode>("add");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const file = flow?.check.file ?? null;

  useEffect(() => {
    setBookId(flow?.bookId ?? (books.length === 1 ? (books[0]?.id ?? "") : ""));
    setPlan(null);
    setMode("add");
    setFailure("");
  }, [flow, books]);

  useEffect(() => {
    if (!file || !bookId) {
      setPlan(null);
      return;
    }
    let alive = true;
    void planImport(file, bookId)
      .then((next) => {
        if (alive) setPlan(next);
      })
      .catch(() => {
        if (alive) setPlan(null);
      });
    return () => {
      alive = false;
    };
  }, [file, bookId]);

  if (!flow) return null;
  const { check } = flow;
  const stats = check.stats;
  const title = books.find((book) => book.id === bookId)?.title ?? "";

  async function submit() {
    if (!file || !bookId) return;
    setBusy(true);
    setFailure("");
    try {
      const result = await applyGlossary(
        bookId,
        file,
        plan && plan.overlap.length > 0 ? mode : "add",
      );
      onDone(bookId, result, [
        ...(stats.chineseWords.length > 0 ? [nonEnglishNotice(stats.chineseWords.length)] : []),
        ...(plan?.warnings ?? []),
      ]);
    } catch (error) {
      setFailure(errorText(error, "err.listAddFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame
      open
      onOpenChange={(open) => !open && onClose()}
      title={check.ok ? t("wl.addTitle") : t("wl.badTitle")}
      description={flow.fileName}
      footer={
        check.ok ? (
          <>
            <button type="button" className={btn.quiet} onClick={onClose}>
              {t("wl.cancel")}
            </button>
            <button
              type="button"
              className={btn.primary}
              disabled={busy || !bookId || !plan}
              onClick={() => void submit()}
            >
              {busy
                ? t("wl.adding")
                : mode === "replace" && plan?.overlap.length
                  ? t("wl.replaceAndAdd")
                  : t("wl.add")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={btn.quiet} onClick={onClose}>
              {t("wl.close")}
            </button>
            <button
              type="button"
              className={btn.primary}
              onClick={() => onPickAnother(flow.bookId)}
            >
              <FileJson className="size-4" aria-hidden />
              {t("wl.chooseAnother")}
            </button>
          </>
        )
      }
    >
      {!check.ok ? (
        <>
          {flow.withBook ? (
            <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm">
              {t("wl.bookNotAdded", { name: flow.withBook })}
            </p>
          ) : null}
          <p>{t("wl.nothingChanged")}</p>
          <ol className="grid list-decimal gap-1.5 pl-5" role="alert">
            {check.errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ol>
          <p className="text-sm text-muted">{t("wl.englishNote")}</p>
          <p className="text-sm">
            <a
              className="font-semibold text-accent underline"
              href={guideUrl()}
              target="_blank"
              rel="noopener"
            >
              {t("guide.fullGuideLink")}
            </a>
          </p>
        </>
      ) : (
        <>
          <p>
            {t("wl.foundLine", {
              found: tn("wl.found", stats.words),
              extra:
                stats.senses > 0
                  ? t("wl.foundExtra", { extra: tn("wl.extraMeanings", stats.senses) })
                  : "",
            })}
          </p>

          {flow.bookId === null ? (
            <label className="grid gap-1 text-sm font-medium">
              {t("wl.which")}
              <select
                className="min-h-11 rounded-lg border border-line bg-card px-3 text-base text-ink"
                value={bookId}
                onChange={(event) => setBookId(event.target.value)}
              >
                <option value="">{t("wl.choose")}</option>
                {books.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-sm text-muted">
              {t("wl.forBook", { title: "\u0001" })
                .split("\u0001")
                .flatMap((piece, i) =>
                  i === 0
                    ? [piece]
                    : [
                        <b key="t" className="text-ink">
                          {title}
                        </b>,
                        piece,
                      ],
                )}
            </p>
          )}

          {stats.chineseWords.length > 0 ? (
            <Notice>{nonEnglishNotice(stats.chineseWords.length)}</Notice>
          ) : null}

          {plan && plan.overlap.length > 0 ? (
            <fieldset className="grid gap-2 rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-semibold">
                {tn("wl.overlap", plan.overlap.length)}
              </legend>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="mode"
                  className="mt-1"
                  checked={mode === "add"}
                  onChange={() => setMode("add")}
                />
                <span>
                  <b>{t("wl.modeAdd")}</b>
                  <span className="block text-sm text-muted">
                    {tn("wl.modeAddHelp", plan.fresh.length, { keep: plan.overlap.length })}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="mode"
                  className="mt-1"
                  checked={mode === "replace"}
                  onChange={() => setMode("replace")}
                />
                <span>
                  <b>{t("wl.modeReplace")}</b>
                  <span className="block text-sm text-muted">
                    {t("wl.modeReplaceHelp", { n: plan.overlap.length + plan.fresh.length })}
                  </span>
                </span>
              </label>
              <p className="text-xs text-muted" lang="en">
                {t("wl.forExample", {
                  list: `${plan.overlap.slice(0, 5).join(", ")}${plan.overlap.length > 5 ? ", …" : ""}`,
                })}
              </p>
            </fieldset>
          ) : plan ? (
            <p className="text-sm text-muted">{t("wl.allNew", { n: plan.fresh.length })}</p>
          ) : null}

          {[...check.warnings, ...(plan?.warnings ?? [])].length > 0 ? (
            <Notice>
              <ul className="grid list-disc gap-1 pl-4">
                {[...check.warnings, ...(plan?.warnings ?? [])].slice(0, 8).map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {failure ? (
            <p className="text-sm font-medium text-warn" role="alert">
              {failure}
            </p>
          ) : null}
        </>
      )}
    </Frame>
  );
}

export function nonEnglishNotice(count: number): string {
  return trn("msg.nonEnglish", count);
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
      <div className="grid gap-1">{children}</div>
    </div>
  );
}
