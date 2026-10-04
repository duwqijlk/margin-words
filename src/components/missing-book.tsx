import { useEffect, useState } from "react";
import { askToSignIn, useCanAddBooks } from "@/lib/can-add";
import { useDownloads } from "@/lib/downloads";
import { bookFileExists } from "@/lib/book-db";
import { rememberListPack, resolveFileOffer, type ResolvedOffer } from "@/lib/file-gap";
import { useT } from "@/lib/i18n";
import { BUNDLED_CATALOG_URL } from "@/lib/packs";
import { btn, cn } from "@/components/ui";

type Card = { id: string; title: string; author: string; isbn?: string; needsEpub?: boolean };

/**
 * A shelf card whose EPUB is not on this device. The card, the progress and the notebook stay.
 * A free classic can be downloaded. A word-list book asks for the reader's own EPUB.
 */
export function MissingBook({
  book,
  onBack,
  onAddEpub,
  onDiscover,
}: {
  book: Card;
  onBack: () => void;
  onAddEpub: () => void;
  onDiscover: () => void;
}) {
  const { t } = useT();
  const canAdd = useCanAddBooks();
  const start = useDownloads((state) => state.start);
  const { id, title, author, isbn, needsEpub } = book;
  const [resolved, setResolved] = useState<ResolvedOffer | null>(null);
  const [failed, setFailed] = useState(false);
  const packId = resolved?.offer.kind === "download" ? resolved.offer.packId : "";
  const item = useDownloads((state) => (packId ? state.items[packId] : undefined));
  const finished = useDownloads((state) => state.finished);

  useEffect(() => {
    let alive = true;
    setResolved(null);
    setFailed(false);
    void resolveFileOffer({ id, title, author, isbn, needsEpub })
      .then((next) => {
        if (alive) setResolved(next);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [id, title, author, isbn, needsEpub]);

  useEffect(() => {
    if (!packId) return;
    void bookFileExists(book.id).then((here) => {
      if (here) window.dispatchEvent(new CustomEvent("cibian-progress", { detail: { bookId: book.id } }));
    });
  }, [book.id, finished, packId]);

  const busy = Boolean(item && !item.error);
  const error = item?.error ?? "";

  async function addEpub() {
    if (!canAdd) {
      askToSignIn();
      return;
    }
    if (resolved?.offer.kind === "epub") await rememberListPack(book.id, resolved.offer.packId).catch(() => undefined);
    onAddEpub();
  }

  function download() {
    if (!canAdd) {
      askToSignIn();
      return;
    }
    const pack = resolved?.classic;
    if (!pack) {
      onDiscover();
      return;
    }
    useDownloads.getState().dismiss(pack.id);
    void start(BUNDLED_CATALOG_URL, pack);
  }

  const offer = failed ? ({ kind: "discover" } as const) : resolved?.offer;

  return (
    <div className="mx-auto grid max-w-md gap-4 px-6 py-16 text-center" data-missing-book>
      <p className="font-display text-2xl font-semibold">{t("reader.missingTitle")}</p>
      <p className="text-muted">{t("reader.missingBody")}</p>
      {offer?.kind === "download" ? (
        <button type="button" className={cn(btn.primary, "justify-self-center")} disabled={busy} onClick={download}>
          {canAdd ? (busy ? t("reader.downloading") : t("reader.downloadBook")) : t("discover.signInToAdd")}
        </button>
      ) : null}
      {offer?.kind === "epub" ? (
        <button type="button" className={cn(btn.primary, "justify-self-center")} onClick={() => void addEpub()}>
          {canAdd ? t("discover.addEpub") : t("discover.signInToAdd")}
        </button>
      ) : null}
      {offer?.kind === "discover" ? (
        <button type="button" className={cn(btn.primary, "justify-self-center")} onClick={onDiscover}>
          {t("reader.findDiscover")}
        </button>
      ) : null}
      {error ? (
        <p className="text-sm text-warn" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className={cn(btn.quiet, "justify-self-center")} onClick={onBack}>
        {t("reader.backShelf")}
      </button>
    </div>
  );
}
