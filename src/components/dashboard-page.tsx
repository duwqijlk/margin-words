import { Github, Heart, Send, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";
import { QqDialog } from "@/components/qq-dialog";
import { SponsorDialog } from "@/components/sponsor-dialog";
import { btn, cn } from "@/components/ui";
import { trn, useT } from "@/lib/i18n";
import { groupDigits, libraryTotals, type LibraryTotals } from "@/lib/library-totals";
import { BUNDLED_CATALOG_URL, loadCatalog } from "@/lib/packs";
import { loadQqGroups } from "@/lib/qq-groups-config";
import { readSponsorLines } from "@/lib/sponsor";
import { REPO_URL, TELEGRAM_URL } from "@/lib/site-info";
import { useContributors } from "@/lib/contributors";
import { useAccount } from "@/lib/account-store";
import { loadWordListCatalog } from "@/lib/word-list-catalog";

type LoadState = "loading" | "ready" | "error";

type OverviewTab = "library" | "contributors" | "supporters";
const TABS: ReadonlyArray<{ id: OverviewTab; label: "dashboard.tabLibrary" | "dashboard.tabContributors" | "dashboard.tabSupporters" }> = [
  { id: "library", label: "dashboard.tabLibrary" },
  { id: "contributors", label: "dashboard.tabContributors" },
  { id: "supporters", label: "dashboard.tabSupporters" },
];

/** The tab in the address (`?tab=`), so a refresh or a shared link opens the same one. */
function tabFromUrl(): OverviewTab {
  if (typeof window === "undefined") return "library";
  const value = new URLSearchParams(window.location.search).get("tab");
  return value === "contributors" || value === "supporters" ? value : "library";
}

/**
 * Overview sections as text tabs with an underline under the current one: a quiet document-style
 * switch, unlike the filled rounded category chips on Discover.
 */
function OverviewTabs({ tab, onChange }: { tab: OverviewTab; onChange: (tab: OverviewTab) => void }) {
  const { t } = useT();
  return (
    <div role="tablist" aria-label={t("dashboard.title")} className="flex gap-6 border-b border-line/70 sm:gap-8" data-overview-tabs>
      {TABS.map((item) => {
        const on = item.id === tab;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`overview-tab-${item.id}`}
            aria-selected={on}
            aria-controls={`overview-panel-${item.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              const at = TABS.findIndex((entry) => entry.id === tab);
              const next = TABS[(at + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
              if (next) {
                onChange(next.id);
                document.getElementById(`overview-tab-${next.id}`)?.focus();
              }
            }}
            className={cn(
              "relative -mb-px min-h-11 border-b-2 px-0.5 text-[0.95rem] transition-colors",
              on ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink",
            )}
            data-overview-tab={item.id}
          >
            {t(item.label)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Readers whose own meanings went into word lists, most help first (contributors.json, one cached
 * file). Hidden until someone has been credited.
 */
function ContributorRank() {
  const { t } = useT();
  const people = useContributors();
  const myId = useAccount((state) => state.publicId);
  const signedIn = useAccount((state) => state.phase === "in");
  const [everyone, setEveryone] = useState(false);
  const mine = myId ? people.findIndex((person) => person.id === myId) : -1;
  const me = mine >= 0 ? people[mine] : undefined;
  const top = people.slice(0, 10);
  const rest = people.slice(10);
  return (
    <section className="grid gap-5" aria-label={t("dashboard.rankTitle")} data-contributor-rank>
      <p className="px-1 text-sm leading-6 text-muted">{t("dashboard.rankIntro")}</p>
      {signedIn ? (
        <p className="rounded-2xl bg-accent-soft px-4 py-3 text-sm" data-rank-mine>
          {me
            ? t("dashboard.rankMine", { n: me.helped, place: mine + 1 })
            : t("dashboard.rankMineNone")}
        </p>
      ) : null}
      {people.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-muted" data-rank-empty>
          {t("dashboard.rankEmpty")}
        </p>
      ) : (
        <ol className="grid gap-px overflow-hidden rounded-2xl bg-line/60">
          {top.map((person, index) => {
            const name = person.name || t("card.creditAnon");
            return (
              <li
                key={person.id}
                className={cn("flex items-center gap-3 bg-card px-4 py-3", person.id === myId && "bg-accent-soft/60")}
                data-rank-row={person.id}
              >
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
      )}
      {rest.length > 0 ? (
        <div className="grid gap-3">
          <button
            type="button"
            className="justify-self-start px-1 text-sm font-medium text-accent underline-offset-4 hover:underline"
            aria-expanded={everyone}
            onClick={() => setEveryone((open) => !open)}
            data-rank-everyone
          >
            {everyone ? t("dashboard.rankLess") : t("dashboard.rankAll", { n: people.length })}
          </button>
          {everyone ? (
            <ul className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-5" data-rank-grid>
              {rest.map((person) => {
                const name = person.name || t("card.creditAnon");
                return (
                  <li key={person.id} className="grid justify-items-center gap-1 text-center" data-rank-cell={person.id}>
                    <Avatar id={person.id} name={person.name} version={person.avatar} size={40} />
                    <span className="max-w-full truncate text-xs font-medium">{name}</span>
                    <span className="text-[0.7rem] tabular-nums text-muted">{trn("count.meaningHelped", person.helped)}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
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

  const [tab, setTab] = useState<OverviewTab>(tabFromUrl);
  const chooseTab = (next: OverviewTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "library") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12"
      data-dashboard
      data-dashboard-state={state}
    >
      <div className="grid gap-6">
        <OverviewTabs tab={tab} onChange={chooseTab} />
        <div role="tabpanel" id={`overview-panel-${tab}`} aria-labelledby={`overview-tab-${tab}`} data-overview-panel={tab}>
          {tab === "library" ? (
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
            </div>
          ) : tab === "contributors" ? (
            <ContributorRank />
          ) : (
            <section className="grid gap-5" aria-label={t("dashboard.tabSupporters")} data-supporters>
              <p className="px-1 text-sm leading-6 text-muted">{t("dashboard.supportersIntro")}</p>
              {names !== null && names.length > 0 ? (
                <>
                  <p className="flex items-center gap-1.5 px-1 text-sm font-semibold" data-supporter-count>
                    <Heart className="size-4 shrink-0 text-accent" strokeWidth={1.5} aria-hidden />
                    {trn("count.supporter", names.length)}
                  </p>
                  <ul className="flex flex-wrap gap-2" data-supporter-names>
                    {names.map((name) => (
                      <li key={name} className="rounded-full bg-card px-3 py-1.5 text-sm">
                        {name}
                      </li>
                    ))}
                  </ul>
                </>
              ) : names !== null ? (
                <p className="px-1 py-6 text-center text-sm text-muted">{t("dashboard.supportersEmpty")}</p>
              ) : null}
              <button type="button" className={cn(btn.primary, "justify-self-start rounded-full px-6")} onClick={() => setOpen(true)} data-sponsor-link>
                <Heart className="size-4" strokeWidth={1.5} aria-hidden />
                {t("dashboard.supportUs")}
              </button>
            </section>
          )}
        </div>
        <DashboardLinks />
      </div>
      <SponsorDialog open={open} onOpenChange={setOpen} onSubmitted={() => setReload((n) => n + 1)} />
    </div>
  );
}
