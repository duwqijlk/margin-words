import { Github, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { ThanksSection } from "@/components/thanks-page";
import { btn } from "@/components/ui";
import { trn, useT } from "@/lib/i18n";
import { groupDigits, libraryTotals, type LibraryTotals } from "@/lib/library-totals";
import { BUNDLED_CATALOG_URL, loadCatalog } from "@/lib/packs";
import { REPO_URL, TELEGRAM_URL } from "@/lib/site-info";
import { loadWordListCatalog } from "@/lib/word-list-catalog";

type LoadState = "loading" | "ready" | "error";

const CARDS: ReadonlyArray<{
  id: "books" | "words" | "paragraphs" | "sentences" | "phrases" | "series";
  label: "dashboard.books" | "dashboard.words" | "dashboard.paragraphs" | "dashboard.sentences" | "dashboard.phrases" | "dashboard.series";
  count: "count.book" | "count.word" | "count.paragraph" | "count.sentence" | "count.phrase" | "count.series";
}> = [
  { id: "books", label: "dashboard.books", count: "count.book" },
  { id: "words", label: "dashboard.words", count: "count.word" },
  { id: "paragraphs", label: "dashboard.paragraphs", count: "count.paragraph" },
  { id: "sentences", label: "dashboard.sentences", count: "count.sentence" },
  { id: "phrases", label: "dashboard.phrases", count: "count.phrase" },
  { id: "series", label: "dashboard.series", count: "count.series" },
];

/** GitHub and Telegram, the last row under the library counts. Shown even when the counts fail to load. */
function DashboardLinks() {
  const { t } = useT();
  const linkClass =
    "inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted underline-offset-4 hover:text-ink hover:underline";
  return (
    <nav className="flex items-center justify-center gap-4" aria-label={t("dashboard.links")} data-dashboard-links>
      <a className={linkClass} href={REPO_URL} target="_blank" rel="noopener noreferrer" data-dashboard-github>
        <Github className="size-4" strokeWidth={1.5} aria-hidden />
        {t("dashboard.github")}
      </a>
      <a className={linkClass} href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" data-dashboard-telegram>
        <Send className="size-4" strokeWidth={1.5} aria-hidden />
        {t("dashboard.telegram")}
      </a>
    </nav>
  );
}

/**
 * One screen: the thank-you list fills the page, and the library counts sit along the bottom.
 * The GitHub and Telegram links are the last row, under those counts.
 * The counts are every book on Discover, not the books on this device.
 */
export function DashboardScreen() {
  const { t } = useT();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>("loading");
  const [totals, setTotals] = useState<LibraryTotals | null>(null);

  useEffect(() => {
    let alive = true;
    setState("loading");
    void (async () => {
      try {
        const [catalog, lists] = await Promise.all([loadCatalog(BUNDLED_CATALOG_URL), loadWordListCatalog()]);
        if (!alive) return;
        setTotals(libraryTotals(catalog.catalog.packs, lists));
        setState("ready");
      } catch {
        if (!alive) return;
        setTotals(null);
        setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [attempt]);

  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8"
      data-dashboard
      data-dashboard-state={state}
    >
      <ThanksSection />
      <div className="grid gap-4">
        {state === "error" ? (
          <div className="grid justify-items-center gap-3 text-center" role="alert">
            <p className="text-[0.95rem] leading-7">{t("dashboard.error")}</p>
            <button type="button" className={btn.primary} onClick={() => setAttempt((n) => n + 1)}>
              {t("dashboard.retry")}
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-6">
            {CARDS.map((card) => {
              const n = card.id === "series" ? (totals?.series.length ?? 0) : (totals?.[card.id] ?? 0);
              const shown = state === "ready";
              return (
                <li
                  key={card.id}
                  className="grid justify-items-center gap-0.5 text-center"
                  data-dash={card.id}
                  data-dash-value={shown ? n : undefined}
                  aria-label={shown ? trn(card.count, n) : t("dashboard.loading")}
                >
                  <p className="font-display text-2xl font-semibold tabular-nums sm:text-3xl" aria-hidden>
                    {shown ? groupDigits(n) : "…"}
                  </p>
                  <p className="text-xs leading-4 text-muted">{t(card.label)}</p>
                </li>
              );
            })}
          </ul>
        )}
        <DashboardLinks />
      </div>
    </div>
  );
}
