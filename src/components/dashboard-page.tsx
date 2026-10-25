import { Github, Heart, Send, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";
import { QqDialog } from "@/components/qq-dialog";
import { SponsorDialog } from "@/components/sponsor-dialog";
import { btn } from "@/components/ui";
import { trn, useT } from "@/lib/i18n";
import { groupDigits, libraryTotals, type LibraryTotals } from "@/lib/library-totals";
import { BUNDLED_CATALOG_URL, loadCatalog } from "@/lib/packs";
import { loadQqGroups } from "@/lib/qq-groups-config";
import { readSponsorLines } from "@/lib/sponsor";
import { REPO_URL, TELEGRAM_URL } from "@/lib/site-info";
import { useContributors } from "@/lib/contributors";
import { loadWordListCatalog } from "@/lib/word-list-catalog";

type LoadState = "loading" | "ready" | "error";

/**
 * Readers whose own meanings went into word lists, most help first (contributors.json, one cached
 * file). Hidden until someone has been credited.
 */
function ContributorRank() {
  const { t } = useT();
  const people = useContributors();
  if (people.length === 0) return null;
  const top = people.slice(0, 10);
  return (
    <section className="grid gap-3" aria-label={t("dashboard.rankTitle")} data-contributor-rank>
      <div className="grid gap-0.5 px-1">
        <h2 className="text-base font-semibold">{t("dashboard.rankTitle")}</h2>
        <p className="text-xs text-muted">{t("dashboard.rankIntro")}</p>
      </div>
      <ol className="grid gap-px overflow-hidden rounded-2xl bg-line/60">
        {top.map((person, index) => {
          const name = person.name || t("card.creditAnon");
          return (
            <li key={person.id} className="flex items-center gap-3 bg-card px-4 py-3" data-rank-row={person.id}>
              <span className="w-5 shrink-0 text-right text-sm tabular-nums text-muted">{index + 1}</span>
              <Avatar id={person.id} name={person.name} version={person.avatar} size={32} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
              <span className="shrink-0 text-sm tabular-nums text-muted" data-rank-helped>
                {trn("count.meaningHelped", person.helped)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const CARDS: ReadonlyArray<{
  id: "books" | "words" | "paragraphs" | "sentences" | "phrases" | "series";
  label: "dashboard.books" | "dashboard.words" | "dashboard.paragraphs" | "dashboard.sentences" | "dashboard.phrases" | "dashboard.series";
  count: "count.book" | "count.word" | "count.paragraph" | "count.sentence" | "count.phrase" | "count.series";
}> = [
  { id: "books", label: "dashboard.books", count: "count.book" },
  { id: "series", label: "dashboard.series", count: "count.series" },
  { id: "words", label: "dashboard.words", count: "count.word" },
  { id: "phrases", label: "dashboard.phrases", count: "count.phrase" },
  { id: "paragraphs", label: "dashboard.paragraphs", count: "count.paragraph" },
  { id: "sentences", label: "dashboard.sentences", count: "count.sentence" },
];

/** GitHub, Telegram, and QQ, the last row under the library counts. Shown even when the counts fail to load. */
function DashboardLinks() {
  const { t } = useT();
  const [qqOpen, setQqOpen] = useState(false);
  const [groups, setGroups] = useState<string[] | null>(null);
  const linkClass =
    "inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted underline-offset-4 hover:text-ink hover:underline";

  useEffect(() => {
    let alive = true;
    void loadQqGroups().then((state) => {
      if (alive) setGroups(state.groups);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <nav className="flex flex-wrap items-center justify-center gap-4" aria-label={t("dashboard.links")} data-dashboard-links>
      <a className={linkClass} href={REPO_URL} target="_blank" rel="noopener noreferrer" data-dashboard-github>
        <Github className="size-4" strokeWidth={1.5} aria-hidden />
        {t("dashboard.github")}
      </a>
      <a className={linkClass} href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" data-dashboard-telegram>
        <Send className="size-4" strokeWidth={1.5} aria-hidden />
        {t("dashboard.telegram")}
      </a>
      {groups && groups.length > 0 ? (
        <button type="button" className={linkClass} onClick={() => setQqOpen(true)} data-dashboard-qq>
          <Users className="size-4" strokeWidth={1.5} aria-hidden />
          {t("dashboard.qq")}
        </button>
      ) : null}
      <QqDialog open={qqOpen} onOpenChange={setQqOpen} groups={groups ?? []} />
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
          <div className="grid gap-3">
            <ul
              className="grid grid-cols-2 gap-2 sm:grid-flow-col sm:grid-cols-3 sm:grid-rows-2 sm:gap-3"
              data-dashboard-counts
            >
              {CARDS.map((card) => {
                const n = card.id === "series" ? (totals?.series.length ?? 0) : (totals?.[card.id] ?? 0);
                const shown = state === "ready";
                return (
                  <li
                    key={card.id}
                    className="grid content-center gap-1 rounded-2xl bg-card px-4 py-5 sm:px-6 sm:py-7"
                    data-dash={card.id}
                    data-dash-value={shown ? n : undefined}
                    aria-label={shown ? trn(card.count, n) : t("dashboard.loading")}
                  >
                    <p className="text-xs text-muted sm:text-sm" aria-hidden>
                      {t(card.label)}
                    </p>
                    <p
                      className="text-[1.7rem] leading-tight font-semibold tracking-tight tabular-nums sm:text-[2.4rem]"
                      aria-hidden
                    >
                      {shown ? groupDigits(n) : "…"}
                    </p>
                  </li>
                );
              })}
            </ul>
            {state === "ready" && totals ? (
              <p className="px-1 text-xs leading-5 text-muted sm:text-sm" data-dashboard-mix>
                {t("dashboard.mix", { classics: groupDigits(totals.classics), lists: groupDigits(totals.lists) })}
              </p>
            ) : null}
          </div>
        )}
        <ContributorRank />
        <div
          className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-sm leading-6 text-muted"
          data-supporters
        >
          {names !== null && names.length > 0 ? (
            <>
              <Heart className="size-4 shrink-0 text-accent" strokeWidth={1.5} aria-hidden />
              <span className="font-semibold" data-supporter-count>
                {trn("count.supporter", names.length)}
              </span>
              <span aria-hidden>·</span>
              <span data-supporter-names>
                {shown.join(", ")}
                {more > 0 ? ` ${t("dashboard.namesMore", { n: more })}` : ""}
              </span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1.5 px-1 font-semibold text-accent underline-offset-4 hover:underline"
            onClick={() => setOpen(true)}
            data-sponsor-link
          >
            {names !== null && names.length > 0 ? null : <Heart className="size-4" strokeWidth={1.5} aria-hidden />}
            {t("dashboard.supportUs")}
          </button>
        </div>
        <DashboardLinks />
      </div>
      <SponsorDialog open={open} onOpenChange={setOpen} onSubmitted={() => setReload((n) => n + 1)} />
    </div>
  );
}
