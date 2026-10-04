import { LayoutDashboard } from "lucide-react";
import { useEffect, useState } from "react";
import { btn } from "@/components/ui";
import { trn, useT } from "@/lib/i18n";
import { groupDigits, libraryTotals, type LibraryTotals } from "@/lib/library-totals";
import { BUNDLED_CATALOG_URL, loadCatalog } from "@/lib/packs";
import { loadWordListCatalog } from "@/lib/word-list-catalog";

type LoadState = "loading" | "ready" | "error";

const CARDS: ReadonlyArray<{
  id: "books" | "words" | "paragraphs";
  label: "dashboard.books" | "dashboard.words" | "dashboard.paragraphs";
  count: "count.book" | "count.word" | "count.paragraph";
}> = [
  { id: "books", label: "dashboard.books", count: "count.book" },
  { id: "words", label: "dashboard.words", count: "count.word" },
  { id: "paragraphs", label: "dashboard.paragraphs", count: "count.paragraph" },
];

/**
 * How many books Discover offers, and how many words and paragraph notes those lists mark.
 * The numbers are the library, not the books on this device.
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
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 sm:px-6 sm:py-10" data-dashboard data-dashboard-state={state}>
      <div className="grid gap-3">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <LayoutDashboard className="size-6" aria-hidden />
        </span>
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">{t("dashboard.title")}</h1>
        <p className="max-w-2xl text-[1rem] leading-7 text-muted">{t("dashboard.intro")}</p>
      </div>
      {state === "error" ? (
        <div className="grid justify-items-start gap-3 rounded-2xl border border-line bg-card px-5 py-8" role="alert">
          <p className="text-[0.95rem] leading-7">{t("dashboard.error")}</p>
          <button type="button" className={btn.primary} onClick={() => setAttempt((n) => n + 1)}>
            {t("dashboard.retry")}
          </button>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-3">
          {CARDS.map((card) => {
            const n = totals?.[card.id] ?? 0;
            const shown = state === "ready";
            return (
              <li
                key={card.id}
                className="grid gap-1 rounded-2xl border border-line bg-card px-5 py-6"
                data-dash={card.id}
                data-dash-value={shown ? n : undefined}
                aria-label={shown ? trn(card.count, n) : t("dashboard.loading")}
              >
                <p className="font-display text-4xl font-semibold tabular-nums sm:text-5xl" aria-hidden>
                  {shown ? groupDigits(n) : "…"}
                </p>
                <p className="text-[0.95rem] font-medium text-muted">{t(card.label)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
