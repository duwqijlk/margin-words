import { Info, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n";

/**
 * The one notice of the site, above the bottom bar: one short line that the site hosts no books
 * under copyright and counts word taps (`recordWordTap` in lib/word-taps-collector.ts). The Guide
 * it used to link to is gone; the account dialog keeps the privacy note.
 * It used to be two full paragraphs, which covered the bottom of the shelf.
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
  return (
    <div
      className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 px-3 sm:bottom-4"
      role="note"
      data-site-notice
    >
      <div className="relative mx-auto max-w-md rounded bg-sheet px-3 py-2 pr-11 shadow-lift">
        {/* One short line. */}
        <p className="flex items-start gap-2 text-[0.8rem] leading-snug">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1">
            {t("notice.short")}
          </span>
        </p>
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
