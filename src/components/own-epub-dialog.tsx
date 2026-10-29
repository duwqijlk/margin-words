import { captureTarget, targetIsCurrent } from "@/lib/book-mutation";
import { requestScope } from "@/lib/cancel-work";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAccount } from "@/lib/account-store";
import { loadPackRecord } from "@/lib/book-db";
import { errorText, tr, useT } from "@/lib/i18n";
import { createOwnEpubFlow, needsPairConfirmation, type OwnEpubState, type PairingWork } from "@/lib/own-epub-flow";
import { fetchWordList, previewOwnEpub, savePaired, type PairPreview } from "@/lib/pair-epub";
import { registerInstalled } from "@/lib/shelf-register";
import { useVocab } from "@/lib/vocab-store";
import { loadWordListCatalog, type WordListPack } from "@/lib/word-list-catalog";
import { SpineWarningList } from "@/components/spine-warnings";
import { btn, cn } from "@/components/ui";
import type { SpineNameWarning } from "@/lib/epub";

type Props = {
  bookId: string | null;
  onClose: () => void;
  onSaved: (bookId: string, warnings: SpineNameWarning[]) => void;
};

/** A new shelf target owns a new lifetime, including its download, preview and commit lock. */
export function OwnEpubDialog(props: Props) {
  return props.bookId === null ? null : <OwnEpubSession key={props.bookId} {...props} bookId={props.bookId} />;
}

function OwnEpubSession({ bookId, onClose, onSaved }: Props & { bookId: string }) {
  const { t } = useT();
  const role = useAccount((state) => state.role);
  const trusted = role === "trusted" || role === "admin";
  const shelfIsbn = useVocab((state) => state.books.find((item) => item.id === bookId)?.isbn ?? "");
  const [pack, setPack] = useState<WordListPack | null>(null);
  const [loadError, setLoadError] = useState("");
  const [stage, setStage] = useState("");
  const [state, setState] = useState<OwnEpubState<PairPreview>>({ phase: "idle", preview: null, error: null });
  const savedCallback = useRef(onSaved);
  useLayoutEffect(() => {
    savedCallback.current = onSaved;
  }, [onSaved]);
  const [mutation] = useState(() => captureTarget(bookId));
  const [flow] = useState(() => createOwnEpubFlow({
    change: setState,
    prepareSave: true,
    hasTarget: () => targetIsCurrent(mutation) && useVocab.getState().books.some((item) => item.id === bookId),
    targetMissing: () => new Error(tr("err.bookGone")),
    save: (preview, work) => savePaired(preview, { targetBookId: bookId, mutation, signal: work.signal, onWrite: work.writing }),
    register: (saved, preview) => registerInstalled(saved, { matchRate: preview.percent }),
    saved: (saved, preview) => savedCallback.current(saved.bookId, preview.warnings),
  }));

  // Layout cleanup invalidates old results as soon as this dialog closes or changes target.
  useLayoutEffect(() => {
    flow.open();
    return () => { flow.cancel(true); };
  }, [flow]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const record = await loadPackRecord(bookId);
      if (!alive) return;
      if (!record) throw new Error(tr("err.bookGone"));
      const lists = await loadWordListCatalog();
      if (!alive) return;
      const found = lists.find((item) => item.id === record.packId);
      if (!found) throw new Error(tr("err.bookAddFailed"));
      setPack(found);
    })().catch((reason) => {
      if (alive) setLoadError(errorText(reason, "err.bookAddFailed"));
    });
    return () => { alive = false; };
  }, [bookId]);

  const pending = state.preview;
  const busy = state.phase === "checking" || state.phase === "downloading" || state.phase === "preparing" || state.phase === "saving" || state.phase === "done";
  const saving = state.phase === "saving" || state.phase === "done";
  const low = pending !== null && pending.match.kind !== "none" && needsPairConfirmation(pending.match);
  const isbn = pack?.isbn || shelfIsbn;
  const error = state.error ? errorText(state.error, "err.bookAddFailed") : loadError;
  const progress = state.phase === "saving" || state.phase === "preparing" ? t("lists.saving")
    : state.phase === "downloading" ? stage || t("lists.downloading")
      : state.phase === "checking" ? stage || t("lists.working") : "";

  function close() {
    if (flow.cancel()) onClose();
  }

  async function preview(file: File, selected: WordListPack, work: PairingWork) {
    work.check();
    setStage("");
    work.checking();
    const glossaryText = await fetchWordList(selected, undefined, work.signal);
    work.check();
    return previewOwnEpub(file, selected, glossaryText, (done, total) => {
      if (work.current()) setStage(tr("lists.checkProgress", { done, total }));
    }, work.signal);
  }

  function onFile(file: File | undefined) {
    if (!file || !pack) return;
    setStage("");
    void flow.start((work) => preview(file, pack, work), "checking");
  }

  function onLibrary() {
    if (!pack || !trusted) return;
    const selected = pack;
    setStage("");
    void flow.start(async (work) => {
      const scope = requestScope(work.signal, 120000);
      try {
      const response = await scope.run(fetch(`/api/book/${encodeURIComponent(selected.id)}/epub`, {
        cache: "no-store", signal: scope.signal,
      }));
      work.check();
      if (!response.ok) {
        if (response.status === 404) throw new Error(tr("err.libraryMissing"));
        if (response.status === 429) throw new Error(tr("account.err.rate"));
        throw new Error(tr("err.bookAddFailed"));
      }
      // Keep the transfer cancellable, including while a stream read is pending.
      let buffer: ArrayBuffer;
      const reader = response.body?.getReader();
      if (reader) {
        const cancelReader = () => { void reader.cancel().catch(() => {}); };
        scope.signal?.addEventListener("abort", cancelReader);
        try {
          const chunks: Uint8Array[] = [];
          let received = 0;
          for (;;) {
            const { done, value } = await scope.run(reader.read());
            work.check();
            if (done) break;
            if (value) {
              chunks.push(value);
              received += value.length;
              setStage(tr("lists.downloaded", { mb: (received / 1048576).toFixed(1) }));
            }
          }
          buffer = new ArrayBuffer(received);
          const bytes = new Uint8Array(buffer);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
        } finally {
          scope.signal?.removeEventListener("abort", cancelReader);
          void reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } else {
        buffer = await scope.run(response.arrayBuffer());
      }
      work.check();
      return await preview(new File([buffer], `${selected.id}.epub`, { type: "application/epub+zip" }), selected, work);
      } finally { scope.dispose(); }
    }, "downloading");
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/[0.32]" />
        <Dialog.Content
          className="anim-pop fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-paper p-5 text-ink shadow-lift "
          data-own-epub-phase={error ? "error" : state.phase}
          aria-busy={busy}
          onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}
          onInteractOutside={(event) => { if (saving) event.preventDefault(); }}
        >
          <Dialog.Title className="font-bold tracking-[-0.02em] text-xl">{t("discover.promptTitle")}</Dialog.Title>
          <Dialog.Description
            className={cn("mt-3 text-sm", low ? "text-warn" : "text-ink")}
            data-match-rate={pending ? pending.match.kind === "none" ? "none" : pending.percent : undefined}
            data-match-kind={pending?.match.kind}
          >
            {pending
              ? pending.match.kind === "none"
                ? t("lists.matchNone")
                : low
                  ? t("lists.matchWarn", { n: pending.percent })
                  : t("lists.match", { n: pending.percent })
              : isbn
                ? t("discover.prompt", { isbn })
                : t("discover.promptPlain")}
          </Dialog.Description>
          {pending && pending.warnings.length > 0 ? (
            <div className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
              <SpineWarningList warnings={pending.warnings} />
            </div>
          ) : null}
          {error ? (
            <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">{error}</p>
          ) : null}
          {progress ? (
            <p className="mt-3 text-sm text-muted" role="status" data-own-epub-stage>{progress}</p>
          ) : null}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={btn.quiet} disabled={saving} onClick={close}>{t("common.close")}</button>
            {pending ? (
              <button
                type="button"
                className={btn.primary}
                disabled={busy}
                data-own-epub-confirm={state.phase === "confirm" ? "" : undefined}
                data-own-epub-retry={state.phase === "error" ? "" : undefined}
                onClick={() => void flow.confirm()}
              >
                {saving ? t("lists.saving") : state.phase === "error" ? t("lists.retrySave") : t("lists.useFile")}
              </button>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                {trusted && pack ? (
                  <button
                    type="button"
                    className={cn(btn.quiet, busy ? "pointer-events-none opacity-60" : "")}
                    disabled={busy}
                    data-library-open
                    onClick={onLibrary}
                  >
                    {state.phase === "downloading" ? t("lists.downloading") : t("lists.openLibrary")}
                  </button>
                ) : null}
                <label className={cn(btn.primary, busy || !pack ? "pointer-events-none opacity-60" : "")}>
                  {state.phase === "checking" ? t("lists.working") : t("discover.addEpub")}
                  <input
                    data-own-epub
                    className="sr-only"
                    type="file"
                    accept=".epub,application/epub+zip"
                    disabled={!pack || busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      onFile(file);
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
