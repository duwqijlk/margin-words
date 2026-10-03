import { Info, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n";
import { navigate } from "@/lib/router";

const KEY = "cibian-notice-v1";
const CHANGED = "cibian-notice";

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

/** A slim notice at the top of every page. Dismissing it is remembered on this device. */
export function NoticeBar() {
  const { t } = useT();
  const saved = useSyncExternalStore(subscribe, dismissed, () => true);
  if (saved) return null;
  return (
    <div
      className="border-b border-line bg-accent-soft text-ink"
      role="note"
      data-notice-bar
    >
      <div className="mx-auto flex max-w-6xl items-start gap-2 px-3 py-1.5 sm:items-center sm:px-6">
        <Info className="mt-0.5 size-4 shrink-0 text-accent sm:mt-0" aria-hidden />
        <p className="min-w-0 flex-1 text-[0.8rem] leading-snug">
          {t("notice.text")}{" "}
          <a
            href="/guide"
            className="-my-2.5 inline-flex min-h-10 items-center align-middle font-semibold underline underline-offset-2"
            data-notice-about
            onClick={(event) => {
              event.preventDefault();
              navigate({ kind: "guide" });
            }}
          >
            {t("notice.link")}
          </a>
        </p>
        <button
          type="button"
          className="-my-1.5 -mr-1 inline-flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-black/5"
          aria-label={t("notice.dismiss")}
          data-notice-close
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
