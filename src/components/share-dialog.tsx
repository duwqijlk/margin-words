import * as Dialog from "@radix-ui/react-dialog";
import { Download, Share2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { finishedDate, readingOverview } from "@/lib/reading-stats";
import {
  CARD_H,
  CARD_W,
  loadCardFonts,
  loadCover,
  renderCardBlob,
  SHARE_THEMES,
  SHARE_URL,
  PALETTES,
  type BookCardData,
  type Ground,
  type OverviewCardData,
  type ShareCardData,
  type ShareTheme,
} from "@/lib/share-card";
import { pickTone, toneStyle } from "@/lib/tone-math";
import { bookSyncKey } from "@/lib/sync-merge";
import { useVocab } from "@/lib/vocab-store";
import { wordsFromBook } from "@/lib/wordbook";
import { useCovers } from "@/components/book-cover";
import { btn, cn, panel, PanelHandle } from "@/components/ui";

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

/**
 * The paper style's ground: the book's own colour from its cover (design system CoverTone), mixed
 * on white as a tint in the corner and a wash further out. None for a grey cover or one the canvas
 * may not read.
 */
function groundOf(image: CanvasImageSource | null): Ground | undefined {
  if (!image) return undefined;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 36;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(image, 0, 0, 24, 36);
    const hex = pickTone(ctx.getImageData(0, 0, 24, 36).data);
    if (!hex) return undefined;
    const tone = toneStyle(hex, "light") as Record<string, string>;
    return { from: tone["--book-tint"] ?? "", to: tone["--book-wash"] ?? "" };
  } catch {
    return undefined;
  }
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
  const finished = useMemo(() => (what.kind === "overview" ? readingOverview(books, words, readDays).finished.slice(0, 3) : []), [what.kind, books, words, readDays]);
  const coverBooks = useMemo(() => (book ? [book] : finished), [book, finished]);
  const covers = useCovers(coverBooks);
  const coverUrl = book ? covers[book.id] : undefined;
  const fanUrls = finished.map((item) => covers[item.id] ?? "").join("\n");
  const [theme, setTheme] = useState<ShareTheme>(savedTheme);
  const [image, setImage] = useState<{ url: string; blob: Blob } | null>(null);
  const [failed, setFailed] = useState(false);

  const footer = useMemo(
    () => ({ brand: "inputread", tagline: t("share.tagline"), site: "inputread.site", scan: t("share.scan") }),
    [t],
  );

  const data = useMemo<Omit<BookCardData, "cover"> | Omit<OverviewCardData, "covers"> | null>(() => {
    if (what.kind === "book") {
      if (!book) return null;
      const saved = wordsFromBook(words, bookSyncKey(book)).length;
      return {
        kind: "book",
        headline: t("share.bookHeadline"),
        title: book.title,
        author: book.author,
        wordsLine: saved > 0 ? tn("share.bookWords", saved) : "",
        seal: t("share.seal"),
        footer,
      };
    }
    const overview = readingOverview(books, words, readDays);
    return {
      kind: "overview",
      headline: `${t("share.overviewHeadline")} · ${t("share.asOf", { date: finishedDate(Date.now(), locale) })}`,
      nums: [
        { label: t("share.statFinished"), value: overview.finished.length, unit: tn("share.unitBooks", overview.finished.length) },
        { label: t("share.statDays"), value: overview.readDays, unit: tn("share.unitDays", overview.readDays) },
        { label: t("share.statWords"), value: overview.words, unit: "" },
      ],
      note: overview.mastered > 0 ? tn("share.mastered", overview.mastered) : "",
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
      let full: ShareCardData;
      if (data.kind === "book") {
        const cover = await loadCover(coverUrl);
        full = { ...data, cover, ground: groundOf(cover) };
      } else {
        const urls = fanUrls ? fanUrls.split("\n") : [];
        const images = await Promise.all(finished.map((_, i) => loadCover(urls[i] || undefined)));
        full = {
          ...data,
          covers: finished.map((item, i) => ({ title: item.title, image: images[i] ?? null })),
          ground: groundOf(images[0] ?? null),
        };
      }
      // A cover the canvas may not read leaves no picture: draw again with made-up covers.
      const blob =
        (await renderCardBlob(full, theme)) ??
        (await renderCardBlob(
          full.kind === "book"
            ? { ...full, cover: null, ground: undefined }
            : { ...full, covers: full.covers.map((item) => ({ ...item, image: null })), ground: undefined },
          theme,
        ));
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
    // `finished` follows `fanUrls`/`data`; listing it would redraw on every store change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data, theme, coverUrl, fanUrls]);

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
        <Dialog.Overlay className={panel.overlay} />
        <Dialog.Content className={cn(panel.content, "sm:w-[min(26rem,calc(100vw-2rem))]")} data-share-dialog={what.kind}>
          <PanelHandle />
          <div className={panel.head}>
            <Dialog.Title className={panel.title}>{t("share.title")}</Dialog.Title>
            <Dialog.Close className={cn(btn.icon, "-mr-2.5")} aria-label={t("common.close")}>
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{t("share.longPress")}</Dialog.Description>

          <div className="grid justify-items-center gap-3.5">
            <div
              className="grid w-[min(18rem,100%)] place-items-center overflow-hidden rounded-2xl bg-sheet shadow-[0_2px_6px_rgb(0_0_0/0.08),0_24px_48px_-20px_rgb(0_0_0/0.35)]"
              style={{ aspectRatio: `${CARD_W} / ${CARD_H}` }}
              data-share-preview
            >
              {image ? (
                <img src={image.url} alt={shareText} className="size-full object-contain" data-share-image />
              ) : (
                <p className="text-sm text-muted" role="status">
                  {failed ? t("share.failed") : t("share.making")}
                </p>
              )}
            </div>

            <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label={t("share.themeLabel")}>
              {SHARE_THEMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={theme === name}
                  onClick={() => pick(name)}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-2 rounded-full border bg-paper py-0 pr-3.5 pl-2 text-sm text-ink",
                    theme === name ? "border-accent font-bold shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb))]" : "border-edge",
                  )}
                  data-share-theme={name}
                >
                  <span className="size-5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(var(--ink-rgb)/0.25)]" style={{ background: PALETTES[name].swatch }} aria-hidden />
                  {t(`share.theme.${name}`)}
                </button>
              ))}
            </div>

            <div className="grid w-full grid-cols-2 gap-2">
              <a
                href={image?.url}
                download={fileName}
                className={cn(btn.primary, "min-h-11", !canShareFile && "col-span-2", !image && "pointer-events-none opacity-50")}
                aria-disabled={!image}
                data-share-save
              >
                <Download className="size-4" aria-hidden />
                {t("share.save")}
              </a>
              {canShareFile ? (
                <button type="button" className={cn(btn.quiet, "min-h-11")} onClick={() => void share()} data-share-send>
                  <Share2 className="size-4" aria-hidden />
                  {t("share.send")}
                </button>
              ) : null}
            </div>
            <p className="-mt-1.5 m-0 text-center text-xs text-faint">{t("share.longPress")}</p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
