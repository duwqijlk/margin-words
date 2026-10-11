import { Github, Heart, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { SponsorDialog } from "@/components/sponsor-dialog";
import { btn } from "@/components/ui";
import { trn, useT } from "@/lib/i18n";
import { groupDigits, libraryTotals, type LibraryTotals } from "@/lib/library-totals";
import { BUNDLED_CATALOG_URL, loadCatalog } from "@/lib/packs";
import { readSponsorLines } from "@/lib/sponsor";
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
 * The library overview: the six counts are the page, shown large. The supporters
 * stay at the bottom as one quiet line — names without amounts — with a small
 * "support us" link that opens the sponsor dialog. No amounts are shown.
 */
export function DashboardScreen() {
  const { t } = useT();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>("loading");
  const [totals, setTotals] = useState<LibraryTotals | null>(null);
  const [names, setNames] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(0);

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

  useEffect(() => {
    let alive = true;
    void fetch("/api/sponsorships", { credentials: "same-origin" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!alive || !payload || typeof payload !== "object") return;
        const body = payload as { month?: unknown; total?: unknown };
        const month = readSponsorLines(body.month).map((line) => line.name);
        const total = readSponsorLines(body.total).map((line) => line.name);
        setNames([...new Set([...month, ...total])]);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [reload]);

  const shown = (names ?? []).slice(0, 10);
  const more = (names?.length ?? 0) - shown.length;

  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12"
      data-dashboard
      data-dashboard-state={state}
    >
      <div className="grid gap-6">
        {state === "error" ? (
          <div className="grid justify-items-center gap-3 text-center" role="alert">
            <p className="text-[0.95rem] leading-7">{t("dashboard.error")}</p>
            <button type="button" className={btn.primary} onClick={() => setAttempt((n) => n + 1)}>
              {t("dashboard.retry")}
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-3 gap-x-3 gap-y-8 sm:grid-cols-6" data-dashboard-counts>
            {CARDS.map((card) => {
              const n = card.id === "series" ? (totals?.series.length ?? 0) : (totals?.[card.id] ?? 0);
              const shown = state === "ready";
              return (
                <li
                  key={card.id}
                  className="grid justify-items-center gap-1 text-center"
                  data-dash={card.id}
                  data-dash-value={shown ? n : undefined}
                  aria-label={shown ? trn(card.count, n) : t("dashboard.loading")}
                >
                  <p className="font-display text-4xl font-semibold tabular-nums sm:text-5xl" aria-hidden>
                    {shown ? groupDigits(n) : "…"}
                  </p>
                  <p className="text-sm leading-5 text-muted">{t(card.label)}</p>
                </li>
              );
            })}
          </ul>
        )}
        <div className="grid justify-items-center gap-2 text-center" data-supporters>
          {names !== null && names.length > 0 ? (
            <>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-muted" data-supporter-count>
                <Heart className="size-4 text-accent" aria-hidden />
                {t("dashboard.supporters", { n: names.length })}
              </p>
              <p className="text-sm leading-6 text-muted" data-supporter-names>
                {shown.join(" · ")}
                {more > 0 ? ` · ${t("dashboard.namesMore", { n: more })}` : ""}
              </p>
            </>
          ) : null}
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
            onClick={() => setOpen(true)}
            data-sponsor-link
          >
            <Heart className="size-4" strokeWidth={1.5} aria-hidden />
            {t("dashboard.supportUs")}
          </button>
        </div>
        <DashboardLinks />
      </div>
      <SponsorDialog open={open} onOpenChange={setOpen} onSubmitted={() => setReload((n) => n + 1)} />
    </div>
  );
}
