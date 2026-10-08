import { useEffect, useState } from "react";
import { ThanksSection } from "@/components/thanks-page";
import { btn } from "@/components/ui";
import { trn, useT } from "@/lib/i18n";
import { groupDigits, libraryTotals, type LibraryTotals } from "@/lib/library-totals";
import { BUNDLED_CATALOG_URL, loadCatalog } from "@/lib/packs";
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
    if (window.location.hash !== "#thanks") return;
    document.getElementById("thanks")?.scrollIntoView({ block: "start" });
  }, []);

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
      <div className="grid gap-1.5">
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
        <>
        <ul className="grid gap-3 sm:grid-cols-3">
          {CARDS.map((card) => {
            const n = card.id === "series" ? (totals?.series.length ?? 0) : (totals?.[card.id] ?? 0);
            const shown = state === "ready";
            return (
              <li
                key={card.id}
                className="grid content-start gap-1 rounded-2xl border border-line bg-card px-5 py-6"
                data-dash={card.id}
                data-dash-value={shown ? n : undefined}
                aria-label={shown ? trn(card.count, n) : t("dashboard.loading")}
              >
                <p className="font-display text-4xl font-semibold tabular-nums sm:text-5xl" aria-hidden>
                  {shown ? groupDigits(n) : "…"}
                </p>
                <p className="text-[0.95rem] font-medium text-muted">{t(card.label)}</p>
                {shown && card.id === "books" && totals ? (
                  <p className="text-sm leading-6 text-muted">{t("dashboard.mix", { classics: totals.classics, lists: totals.lists })}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
        {state === "ready" && totals ? (
          <section className="grid gap-3" data-dash-series-list>
            <h2 className="font-display text-xl font-semibold">{t("dashboard.series")}</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
              {totals.series.map((row) => (
                <li key={row.name} className="flex items-baseline justify-between gap-4 px-5 py-3" data-series={row.name}>
                  <span className="min-w-0 font-medium" lang="en">{row.name}</span>
                  <span className="shrink-0 tabular-nums text-muted">{trn("count.book", row.books)}</span>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-4 px-5 py-3" data-dash="standalone" data-dash-value={totals.standalone}>
                <span className="font-medium">{t("dashboard.standalone")}</span>
                <span className="shrink-0 tabular-nums text-muted">{trn("count.book", totals.standalone)}</span>
              </li>
            </ul>
          </section>
        ) : null}
        </>
      )}
      <ThanksSection />
    </div>
  );
}
