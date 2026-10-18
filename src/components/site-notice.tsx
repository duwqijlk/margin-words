import { Info, ShieldCheck, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n";
import { navigate } from "@/lib/router";

/**
 * The one notice of the site, above the bottom bar: the two things a reader should know before
 * they start, in one place instead of two bars.
 *
 *   1. This site does not host books under copyright; for those, bring your own EPUB.
 *   2. A word tap is reported: the word, its place in the book, and the sentence around it
 *      (`recordWordTap` in lib/word-taps-collector.ts).
 *
 * One close button hides both, and that choice is remembered on this device. The key is new, so
 * someone who hid the old top bar still sees this one once.
 *
 * The card is position: fixed, so it covers the bottom of the page for a moment and never moves
 * the text. It is not drawn in the reader, where it would sit over the words.
 */
const KEY = "cibian-site-notice-v1";
const CHANGED = "cibian-site-notice";

let hiddenThisVisit = false;

function dismissed(): boolean {
  if (hiddenThisVisit) return true;
  try {
    return localStorage.getItem(KEY) === "hidden";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function SiteNotice() {
  const { t } = useT();
  const saved = useSyncExternalStore(subscribe, dismissed, () => true);
  if (saved) return null;
  const toGuide = (event: React.MouseEvent) => {
    event.preventDefault();
    navigate({ kind: "guide" });
  };
  return (
    <div
      className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 px-3 sm:bottom-4"
      role="note"
      data-site-notice
    >
      <div className="relative mx-auto max-w-md rounded-2xl border border-line bg-paper/95 px-3 py-2.5 pr-11 shadow-xs backdrop-blur">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <p className="min-w-0 flex-1 text-[0.8rem] leading-snug">
            {t("notice.text")}{" "}
            <a
              href="/guide"
              className="font-semibold underline underline-offset-2"
              data-site-notice-about
              onClick={toGuide}
            >
              {t("notice.link")}
            </a>
          </p>
        </div>
        <div className="mt-1.5 flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <p className="min-w-0 flex-1 text-[0.8rem] leading-snug">
            {t("privacyNote.text")}{" "}
            <a
              href="/guide"
              className="font-semibold underline underline-offset-2"
              data-site-notice-privacy
              onClick={toGuide}
            >
              {t("privacyNote.link")}
            </a>
          </p>
        </div>
        <button
          type="button"
          className="absolute top-1 right-1 inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-black/5"
          aria-label={t("notice.dismiss")}
          data-site-notice-close
          onClick={() => {
            try {
              localStorage.setItem(KEY, "hidden");
            } catch {
              hiddenThisVisit = true;
            }
            window.dispatchEvent(new Event(CHANGED));
          }}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
