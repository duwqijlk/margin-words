import { Github, Heart, Send, Users } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { Avatar } from "@/components/avatar";
import { QqDialog } from "@/components/qq-dialog";
import { SponsorDialog } from "@/components/sponsor-dialog";
import { btn, cn, subTabs } from "@/components/ui";
import { trn, useT } from "@/lib/i18n";
import { groupDigits, libraryTotals, type LibraryTotals } from "@/lib/library-totals";
import { BUNDLED_CATALOG_URL, loadCatalog, resolveAgainst } from "@/lib/packs";
import { loadQqGroups } from "@/lib/qq-groups-config";
import { readSponsorLines } from "@/lib/sponsor";
import { REPO_URL, TELEGRAM_URL } from "@/lib/site-info";
import { useBookMaintainers, useContributors } from "@/lib/contributors";
import { ContributorsPanel, type BookFace } from "@/components/overview-people";
import { coverAddress } from "@/lib/covers";
import { useAccount } from "@/lib/account-store";
import { loadWordListCatalog, WORD_LIST_CATALOG_URL } from "@/lib/word-list-catalog";

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

/** Overview sections, as the same plain text tabs as Discover's Novels / Speeches (subTabs in ui.tsx). */
function OverviewTabs({ tab, onChange }: { tab: OverviewTab; onChange: (tab: OverviewTab) => void }) {
  const { t } = useT();
  return (
    <div role="tablist" aria-label={t("dashboard.title")} className={subTabs.row} data-overview-tabs>
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
            className={cn(subTabs.tab, on ? subTabs.on : subTabs.off)}
            data-overview-tab={item.id}
          >
            {t(item.label)}
          </button>
        );
      })}
    </div>
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
function DashboardLinks({ onSponsor }: { onSponsor: () => void }) {
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
      {/* Its own line under the links, on every tab: plain words that open the sponsor dialog. */}
      <button
        type="button"
        className="inline-flex min-h-11 basis-full items-center justify-center gap-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline"
        onClick={onSponsor}
        data-sponsor-link
      >
        <Heart className="size-4" strokeWidth={1.5} aria-hidden />
        {t("dashboard.sponsorProject")}
      </button>
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
  /** Covers for the Contributors tab, keyed `public-books:<id>` / `word-lists:<id>`. */
  const [faces, setFaces] = useState<ReadonlyMap<string, BookFace>>(() => new Map());
  const people = useContributors();
  const maintainers = useBookMaintainers();
  /** Supporters, all time first (the larger gifts), with their public id for the avatar when known. */
  const [names, setNames] = useState<Array<{ name: string; publicId?: string; avatar?: number }> | null>(null);
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
        const next = new Map<string, BookFace>();
        for (const pack of catalog.catalog.packs) {
          next.set(`public-books:${pack.id}`, {
            title: pack.title,
            author: pack.author,
            coverUrl: pack.cover?.url ? coverAddress(resolveAgainst(BUNDLED_CATALOG_URL, pack.cover.url), pack.cover.sha256) : undefined,
            look: pack.category === "speech" ? "talk" : "book",
          });
        }
        for (const pack of lists) {
          next.set(`word-lists:${pack.id}`, {
            title: pack.title,
            author: pack.author,
            coverUrl: pack.cover?.url ? coverAddress(resolveAgainst(WORD_LIST_CATALOG_URL, pack.cover.url), pack.cover.sha256) : undefined,
            look: pack.category === "speech" ? "talk" : "book",
          });
        }
        setFaces(next);
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
        // One row per person: all-time order, then anyone only on this month's board.
        const seen = new Set<string>();
        const people: Array<{ name: string; publicId?: string; avatar?: number }> = [];
        for (const line of [...readSponsorLines(body.total), ...readSponsorLines(body.month)]) {
          const key = line.publicId ?? `name:${line.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          people.push({ name: line.name, publicId: line.publicId, avatar: line.avatar });
        }
        setNames(people);
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
      // The same page frame as Discover (width, gutters, top space), so the sub-tabs sit in the same
      // place on both pages. The content below keeps its narrower reading width, aligned with the tabs.
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-6 sm:gap-6 sm:px-6"
      data-dashboard
      data-dashboard-state={state}
    >
      <OverviewTabs tab={tab} onChange={chooseTab} />
      <div className="grid w-full max-w-3xl gap-6" data-dashboard-body>
        <div key={tab} role="tabpanel" id={`overview-panel-${tab}`} aria-labelledby={`overview-tab-${tab}`} data-overview-panel={tab}>
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
            <div className="grid gap-8">
              {/* The one large thing: how many words are explained, with the highlighter behind it. */}
              <div className="overview-rise grid gap-2 px-1" data-dashboard-hero>
                <p className="font-display font-bold tracking-[-0.02em] [font-variant-numeric:lining-nums_tabular-nums] text-[3.4rem] leading-none tabular-nums sm:text-[5.5rem]">
                  <span className="overview-mark">{state === "ready" && totals ? groupDigits(totals.words) : "…"}</span>
                </p>
                <p className="max-w-md text-[0.95rem] leading-7 text-muted sm:text-base">
                  {t("dashboard.heroWords")}
                  {state === "ready" && totals ? t("dashboard.heroIn", { books: groupDigits(totals.books) }) : ""}
                </p>
              </div>
              <ul className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-5" data-dashboard-counts>
                {CARDS.filter((card) => card.id !== "words").map((card, index) => {
                  const n = card.id === "series" ? (totals?.series.length ?? 0) : (totals?.[card.id] ?? 0);
                  const shown = state === "ready";
                  return (
                    <li
                      key={card.id}
                      className="overview-rise grid gap-1 border-l-2 border-line/80 pl-3"
                      style={{ "--i": index + 1 } as CSSProperties}
                      data-dash={card.id}
                      data-dash-value={shown ? n : undefined}
                      aria-label={shown ? trn(card.count, n) : t("dashboard.loading")}
                    >
                      <p className="font-display font-bold tracking-[-0.02em] [font-variant-numeric:lining-nums_tabular-nums] text-[1.6rem] leading-tight tabular-nums sm:text-[1.9rem]" aria-hidden>
                        {shown ? groupDigits(n) : "…"}
                      </p>
                      <p className="text-xs text-muted sm:text-sm" aria-hidden>
                        {t(card.label)}
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
            <ContributorsPanel people={people} books={maintainers} faces={faces} />
          ) : (
            <section className="grid gap-7" aria-label={t("dashboard.tabSupporters")} data-supporters>
              <p className="overview-rise max-w-prose px-1 text-[0.95rem] leading-7 text-muted">{t("dashboard.supportersIntro")}</p>
              {names !== null && names.length > 0 ? (
                <div className="grid gap-5">
                  <p className="overview-rise px-1 font-bold tracking-[-0.02em] text-xl" data-supporter-count>
                    <span className="overview-mark">{trn("count.supporter", names.length)}</span>
                  </p>
                  {/* No card around each person: a dense wall, so a long list of supporters stays short. */}
                  <ul className="grid grid-cols-5 gap-x-1 gap-y-4 sm:grid-cols-8" data-supporter-names>
                    {names.map((person, index) => (
                      <li
                        key={person.publicId ?? person.name}
                        className="overview-rise grid justify-items-center gap-1.5 text-center"
                        style={{ "--i": Math.min(index, 12) + 1 } as CSSProperties}
                        data-supporter={person.publicId ?? ""}
                      >
                        <Avatar id={person.publicId ?? `name:${person.name}`} name={person.name} version={person.publicId ? person.avatar : undefined} size={40} />
                        <span className="max-w-full truncate text-xs font-medium" title={person.name}>{person.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : names !== null ? (
                <p className="px-1 py-10 text-center font-bold tracking-[-0.02em] text-lg text-muted">{t("dashboard.supportersEmpty")}</p>
              ) : null}
            </section>
          )}
        </div>
      </div>
      {/* The page links stay centred on the page, under the narrower content. */}
      <div className="pt-1 sm:pt-2">
        <DashboardLinks onSponsor={() => setOpen(true)} />
      </div>
      <SponsorDialog open={open} onOpenChange={setOpen} onSubmitted={() => setReload((n) => n + 1)} />
    </div>
  );
}
