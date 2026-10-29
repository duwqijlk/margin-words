import * as Dialog from "@radix-ui/react-dialog";
import { Download, Share2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { asFinishedAt, finishedDate, readingOverview } from "@/lib/reading-stats";
import {
  loadCardFonts,
  loadCover,
  renderCardBlob,
  SHARE_THEMES,
  SHARE_URL,
  PALETTES,
  type BookCardData,
  type OverviewCardData,
  type ShareCardData,
  type ShareTheme,
} from "@/lib/share-card";
import { bookSyncKey } from "@/lib/sync-merge";
import { useVocab } from "@/lib/vocab-store";
import { wordsFromBook } from "@/lib/wordbook";
import { useCovers } from "@/components/book-cover";
import { btn, cn } from "@/components/ui";

const THEME_KEY = "cibian-share-theme-v1";
const COVER_WAIT_MS = 1500;

function savedTheme(): ShareTheme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return SHARE_THEMES.includes(value as ShareTheme) ? (value as ShareTheme) : "paper";
  } catch {
    return "paper";
  }
}

/** The seal's date: digits only, the same in every language (2026.10.28). */
function sealDate(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export type ShareWhat = { kind: "book"; bookId: string } | { kind: "overview" };

/**
 * A share image made on this device: pick one of three styles, then share it (where the browser can
 * share files) or save it. The image is also shown as an <img>, so a phone can press and hold it to
 * save, which is the only way inside WeChat.
 */
export default function ShareDialog({ what, open, onOpenChange }: { what: ShareWhat; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, tn, locale } = useT();
  const books = useVocab((state) => state.books);
  const words = useVocab((state) => state.words);
  const readDays = useVocab((state) => state.readDays);
  const book = what.kind === "book" ? books.find((item) => item.id === what.bookId) : undefined;
  const coverBooks = useMemo(() => (book ? [book] : []), [book]);
  const covers = useCovers(coverBooks);
  const coverUrl = book ? covers[book.id] : undefined;
  const [theme, setTheme] = useState<ShareTheme>(savedTheme);
  const [image, setImage] = useState<{ url: string; blob: Blob } | null>(null);
  const [failed, setFailed] = useState(false);

  const footer = useMemo(
    () => ({ brand: "inputread", tagline: t("share.tagline"), site: "inputread.site", scan: t("share.scan") }),
    [t],
  );

  const data = useMemo<Omit<BookCardData, "cover"> | OverviewCardData | null>(() => {
    if (what.kind === "book") {
      if (!book) return null;
      const finishedAt = asFinishedAt(book.finishedAt) ?? Date.now();
      const saved = wordsFromBook(words, bookSyncKey(book)).length;
      return {
        kind: "book",
        headline: t("share.bookHeadline"),
        title: book.title,
        author: book.author,
        wordsLine: saved > 0 ? tn("share.bookWords", saved) : "",
        seal: t("share.seal"),
        sealDate: sealDate(finishedAt),
        footer,
      };
    }
    const overview = readingOverview(books, words, readDays);
    return {
      kind: "overview",
      headline: t("share.overviewHeadline"),
      asOf: t("share.asOf", { date: finishedDate(Date.now(), locale) }),
      rows: [
        { label: t("share.statFinished"), value: overview.finished.length, unit: tn("share.unitBooks", overview.finished.length) },
        { label: t("share.statDays"), value: overview.readDays, unit: tn("share.unitDays", overview.readDays) },
        { label: t("share.statWords"), value: overview.words, unit: tn("share.unitWords", overview.words) },
      ],
      note: overview.mastered > 0 ? tn("share.mastered", overview.mastered) : "",
      shelf: overview.finished.slice(0, 12).map((item) => ({ title: item.title })),
      footer,
    };
  }, [what.kind, book, books, words, readDays, t, tn, locale, footer]);

  useEffect(() => {
    if (!open || !data) return;
    let alive = true;
    let made: string | null = null;
    setFailed(false);
    setImage(null);
    // The cover's address comes with the catalogs, a moment after the dialog opens. Wait a little
    // for it, so the card is not drawn once with a made-up cover and again with the real one.
    const wait = data.kind === "book" && !coverUrl ? COVER_WAIT_MS : 0;
    const timer = window.setTimeout(() => void (async () => {
      await loadCardFonts();
      const cover = data.kind === "book" ? await loadCover(coverUrl) : null;
      const full = (data.kind === "book" ? { ...data, cover } : data) as ShareCardData;
      // A cover the canvas may not read leaves no picture: draw again with the made-up cover.
      const blob =
        (await renderCardBlob(full, theme)) ??
        (full.kind === "book" ? await renderCardBlob({ ...full, cover: null }, theme) : null);
      if (!alive) return;
      if (!blob) {
        setFailed(true);
        return;
      }
      made = URL.createObjectURL(blob);
      setImage({ url: made, blob });
    })(), wait);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      if (made) URL.revokeObjectURL(made);
    };
  }, [open, data, theme, coverUrl]);

  function pick(next: ShareTheme) {
    // The drawing effect clears the old image when the style really changes.
    if (next === theme) return;
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // The choice is only a convenience.
    }
  }

  const fileName = what.kind === "book" && book ? `inputread-${book.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "book"}.png` : "inputread-my-reading.png";
  const shareText =
    what.kind === "book" && book
      ? t("share.textBook", { title: book.title })
      : t("share.textOverview", { n: readingOverview(books, words, readDays).finished.length });
  const file = image ? new File([image.blob], fileName, { type: "image/png" }) : null;
  const canShareFile =
    !!file && typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });

  async function share() {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: "inputread", text: `${shareText} ${SHARE_URL}` });
    } catch {
      // Closed by the reader, or the target refused: nothing to undo.
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className="anim-pop fixed top-1/2 left-1/2 z-50 grid w-[calc(100vw-2rem)] max-w-md max-h-[calc(100vh-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border border-line bg-card p-5 text-ink shadow-pop"
          data-share-dialog={what.kind}
        >
          <div className="flex items-start justify-between gap-2">
            <Dialog.Title className="text-base font-semibold">{t("share.title")}</Dialog.Title>
            <Dialog.Close className="-mt-1 -mr-1 grid size-9 place-items-center rounded-lg text-muted hover:text-ink" aria-label={t("common.close")}>
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{t("share.longPress")}</Dialog.Description>

          <div className="grid aspect-[3/4] w-full place-items-center overflow-hidden rounded-lg bg-paper ring-1 ring-line" data-share-preview>
            {image ? (
              <img src={image.url} alt={shareText} className="size-full object-contain" data-share-image />
            ) : (
              <p className="text-sm text-muted" role="status">
                {failed ? t("share.failed") : t("share.making")}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2" role="radiogroup" aria-label={t("share.themeLabel")}>
            {SHARE_THEMES.map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={theme === name}
                onClick={() => pick(name)}
                className={cn(
                  "inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-medium",
                  theme === name ? "border-accent text-ink" : "border-line text-muted hover:text-ink",
                )}
                data-share-theme={name}
              >
                <span
                  className="size-3.5 shrink-0 rounded-full ring-1 ring-black/10"
                  style={{ background: PALETTES[name].bg, boxShadow: `inset 0 -5px 0 ${PALETTES[name].accent}` }}
                  aria-hidden
                />
                {t(`share.theme.${name}`)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {canShareFile ? (
              <button type="button" className={cn(btn.primary, "min-h-11")} onClick={() => void share()} data-share-send>
                <Share2 className="size-4" aria-hidden />
                {t("share.send")}
              </button>
            ) : null}
            <a
              href={image?.url}
              download={fileName}
              className={cn(canShareFile ? btn.quiet : btn.primary, "min-h-11", !canShareFile && "col-span-2", !image && "pointer-events-none opacity-50")}
              aria-disabled={!image}
              data-share-save
            >
              <Download className="size-4" aria-hidden />
              {t("share.save")}
            </a>
          </div>
          <p className="text-center text-xs text-muted">{t("share.longPress")}</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
