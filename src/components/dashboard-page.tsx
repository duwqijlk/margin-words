import { Github, Heart, Send, Users } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { Avatar } from "@/components/avatar";
import { QqDialog } from "@/components/qq-dialog";
import { SponsorDialog } from "@/components/sponsor-dialog";
import { btn, cn, subTabs } from "@/components/ui";
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
  const podium = people.slice(0, 3);
  const rows = people.slice(3, 10);
  const rest = people.slice(10);
  const nameOf = (person: { name: string }) => person.name || t("card.creditAnon");
  // Second, first, third: the leader stands in the middle and highest.
  const stand = [podium[1], podium[0], podium[2]];
  return (
    <section className="grid gap-7" aria-label={t("dashboard.rankTitle")} data-contributor-rank>
      <p className="overview-rise max-w-prose px-1 text-[0.95rem] leading-7 text-muted">{t("dashboard.rankIntro")}</p>
      {signedIn ? (
        <p
          className="overview-rise rounded-2xl border border-line/70 px-4 py-3.5 text-sm leading-6"
          style={{ "--i": 1 } as CSSProperties}
          data-rank-mine
        >
          {me ? (
            <>
              <span className="overview-mark font-semibold">{t("dashboard.rankMinePlace", { place: mine + 1 })}</span>{" "}
              {t("dashboard.rankMineCount", { n: me.helped })}
            </>
          ) : (
            t("dashboard.rankMineNone")
          )}
        </p>
      ) : null}
      {people.length === 0 ? (
        <p className="overview-rise px-1 py-10 text-center font-display text-lg text-muted" data-rank-empty>
          {t("dashboard.rankEmpty")}
        </p>
      ) : (
        <>
          <ol className="grid grid-cols-3 items-end gap-2 sm:gap-4" aria-label={t("dashboard.rankTop")} data-rank-podium>
            {stand.map((person, slot) => {
              if (!person) return <li key={`empty-${slot}`} aria-hidden />;
              const place = people.indexOf(person) + 1;
              const first = place === 1;
              return (
                <li
                  key={person.id}
                  className={cn(
                    "overview-rise overview-lift grid justify-items-center gap-2 rounded-3xl px-2 pt-5 pb-4 text-center",
                    first ? "bg-card pb-6 shadow-sm" : "bg-card/60",
                    person.id === myId && "ring-2 ring-accent/40",
                  )}
                  style={{ "--i": slot + 2 } as CSSProperties}
                  data-rank-row={person.id}
                >
                  <span className={cn("font-display tabular-nums", first ? "text-3xl font-semibold" : "text-xl text-muted")}>
                    {place}
                  </span>
                  <Avatar id={person.id} name={person.name} version={person.avatar} size={first ? 64 : 48} />
                  <span className="max-w-full truncate text-sm font-semibold">{nameOf(person)}</span>
                  <span className="text-xs tabular-nums text-muted" data-rank-helped>
                    {trn("count.meaningHelped", person.helped)}
                  </span>
                </li>
              );
            })}
          </ol>
          {rows.length > 0 ? (
            <ol className="grid" start={4}>
              {rows.map((person, index) => (
                <li
                  key={person.id}
                  className={cn(
                    "overview-rise flex items-center gap-3 border-b border-line/50 px-2 py-3 last:border-0",
                    person.id === myId && "rounded-xl bg-accent-soft/60",
                  )}
                  style={{ "--i": index + 5 } as CSSProperties}
                  data-rank-row={person.id}
                >
                  <span className="w-6 shrink-0 text-right font-display text-sm tabular-nums text-muted">{index + 4}</span>
                  <Avatar id={person.id} name={person.name} version={person.avatar} size={36} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{nameOf(person)}</span>
                  <span className="shrink-0 text-sm tabular-nums text-muted" data-rank-helped>
                    {trn("count.meaningHelped", person.helped)}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      )}
      {rest.length > 0 ? (
        <div className="grid gap-4">
          <button
            type="button"
            className="justify-self-center rounded-full border border-line px-5 py-2 text-sm font-medium transition-colors hover:bg-card"
            aria-expanded={everyone}
            onClick={() => setEveryone((open) => !open)}
            data-rank-everyone
          >
            {everyone ? t("dashboard.rankLess") : t("dashboard.rankAll", { n: people.length })}
          </button>
          {everyone ? (
            <ul
              className="scroll-thin grid max-h-[26rem] grid-cols-4 gap-x-2 gap-y-5 overflow-y-auto overscroll-contain rounded-2xl p-1 sm:grid-cols-6"
              data-rank-grid
            >
              {rest.map((person, index) => (
                <li
                  key={person.id}
                  className="overview-rise grid justify-items-center gap-1.5 text-center"
                  style={{ "--i": Math.min(index, 12) } as CSSProperties}
                  title={`${nameOf(person)} · ${trn("count.meaningHelped", person.helped)}`}
                  data-rank-cell={person.id}
                >
                  <Avatar id={person.id} name={person.name} version={person.avatar} size={44} />
                  <span className="max-w-full truncate text-xs font-medium">{nameOf(person)}</span>
                  <span className="text-[0.7rem] tabular-nums text-muted">{person.helped}</span>
                </li>
              ))}
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
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12"
      data-dashboard
      data-dashboard-state={state}
    >
      <div className="grid gap-6">
        <OverviewTabs tab={tab} onChange={chooseTab} />
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
                <p className="font-display text-[3.4rem] leading-none font-semibold tracking-tight tabular-nums sm:text-[5.5rem]">
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
                      <p className="font-display text-[1.6rem] leading-tight font-semibold tabular-nums sm:text-[1.9rem]" aria-hidden>
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
            <ContributorRank />
          ) : (
            <section className="grid gap-7" aria-label={t("dashboard.tabSupporters")} data-supporters>
              <p className="overview-rise max-w-prose px-1 text-[0.95rem] leading-7 text-muted">{t("dashboard.supportersIntro")}</p>
              {names !== null && names.length > 0 ? (
                <div className="grid gap-5">
                  <p className="overview-rise px-1 font-display text-xl" data-supporter-count>
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
                <p className="px-1 py-10 text-center font-display text-lg text-muted">{t("dashboard.supportersEmpty")}</p>
              ) : null}
            </section>
          )}
        </div>
        <DashboardLinks onSponsor={() => setOpen(true)} />
      </div>
      <SponsorDialog open={open} onOpenChange={setOpen} onSubmitted={() => setReload((n) => n + 1)} />
    </div>
  );
}
