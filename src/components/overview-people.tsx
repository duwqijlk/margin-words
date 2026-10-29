/**
 * The Contributors tab of Overview.
 *
 * readers whose own meanings went into the word lists. One large number (all their
 * meanings together, counted up once), then a row per reader with an ink bar for their share and the
 * covers of the books they helped, then a small looping demo of how a meaning gets in. It reads well
 * with one contributor as with a hundred: nothing waits for a second or third place.
 *
 * Motion is CSS (styles.css, "Overview people"), once on arrival, and the demo loops. Everything is
 * still and complete under prefers-reduced-motion, and on browsers without the animations.
 */
import { Check, MessageCircleQuestion } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { Avatar } from "@/components/avatar";
import { BookCover, type CoverLook } from "@/components/book-cover";
import { cn } from "@/components/ui";
import { useAccount } from "@/lib/account-store";
import type { BookMaintainers, Contributor } from "@/lib/contributors";
import { trn, useT } from "@/lib/i18n";
import { groupDigits } from "@/lib/library-totals";
import { useCountUp } from "@/lib/count-up";

/** What a cover needs, keyed by catalog reference (`word-lists:<id>` or `public-books:<id>`). */
export type BookFace = { title: string; author: string; coverUrl?: string; look: CoverLook };

const vars = (values: Record<string, string | number>) => values as CSSProperties;

/**
 * A big number of the overview (design system LibraryStats): Literata, counted up from 0, and once it
 * has landed a highlighter is drawn under it (the yellow of "understood").
 */
export function HeroNumber({ value, ready }: { value: number; ready: boolean }) {
  const { shown, done } = useCountUp(ready ? value : 0);
  return (
    <p className="m-0 font-display text-[60px] leading-[0.95] font-bold tracking-[-0.03em] [font-variant-numeric:lining-nums_tabular-nums] sm:text-[96px]">
      <span className="num-grow px-1" data-on={(ready && done && value > 0) || undefined} aria-hidden>
        <span>{ready ? groupDigits(shown) : "…"}</span>
        <i />
      </span>
      <span className="sr-only">{ready ? groupDigits(value) : ""}</span>
    </p>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Contributors                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

const LISTED = 10;
const COVERS = 4;
/** On a phone the covers stay small and fewer, so the row fits the screen. */
const MOBILE_COVERS = 3;
/** The demo's meaning. Contributed meanings are accepted in English only, so it is English in every locale. */
const DEMO_MEANING = "a safe place where boats stay";

export function ContributorsPanel({
  people,
  books,
  faces,
}: {
  people: Contributor[];
  books: Record<string, BookMaintainers>;
  faces: ReadonlyMap<string, BookFace>;
}) {
  const { t } = useT();
  const myId = useAccount((state) => state.publicId);
  const signedIn = useAccount((state) => state.phase === "in");
  const [everyone, setEveryone] = useState(false);

  const total = people.reduce((sum, person) => sum + person.helped, 0);
  const lead = Math.max(1, people[0]?.helped ?? 1);
  /** Each reader's books: the catalog books whose top helpers include them, most helped first. */
  const helpedBooks = useMemo(() => {
    const out = new Map<string, string[]>();
    const refs = Object.entries(books).sort((a, b) => b[1].count - a[1].count);
    for (const [ref, entry] of refs) {
      for (const id of entry.top) {
        const list = out.get(id) ?? [];
        list.push(ref);
        out.set(id, list);
      }
    }
    return out;
  }, [books]);
  const bookCount = Object.keys(books).length;
  const mine = myId ? people.findIndex((person) => person.id === myId) : -1;
  const me = mine >= 0 ? people[mine] : undefined;
  const listed = people.slice(0, LISTED);
  const rest = people.slice(LISTED);
  const nameOf = (person: { name: string }) => person.name || t("card.creditAnon");

  return (
    <section className="grid gap-9" aria-label={t("dashboard.rankTitle")} data-contributor-rank>
      {people.length > 0 ? (
        <div className="overview-rise grid gap-3" data-rank-hero>
          <HeroNumber value={total} ready />
          <p className="m-0 max-w-[30rem] text-sm leading-relaxed text-muted sm:text-base">
            {t("dashboard.rankHero", { people: groupDigits(people.length), books: groupDigits(bookCount) })}
          </p>
        </div>
      ) : (
        <p className="overview-rise m-0 pt-4 text-2xl leading-snug font-bold tracking-[-0.02em] sm:text-3xl" data-rank-empty>
          {t("dashboard.rankEmpty")}
        </p>
      )}

      {signedIn ? (
        <p className="overview-rise m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded bg-sheet px-4 py-3.5 text-sm text-muted" style={vars({ "--i": 1 })} data-rank-mine>
          {me ? (
            <>
              <b className="text-[21px] font-bold tracking-[-0.02em] text-ink">{t("dashboard.rankMinePlace", { place: me.rank ?? mine + 1 })}</b>
              {t("dashboard.rankMineCount", { n: me.helped })}
            </>
          ) : (
            t("dashboard.rankMineNoneShort")
          )}
        </p>
      ) : null}

      {listed.length > 0 ? (
        <ol className="m-0 list-none border-t border-line p-0" aria-label={t("dashboard.rankTitle")} data-rank-list>
          {listed.map((person, index) => {
            const place = person.rank ?? index + 1;
            const refs = (helpedBooks.get(person.id) ?? []).filter((ref) => faces.has(ref));
            const first = index === 0;
            const top = place <= 3;
            return (
              <li
                key={person.id}
                className={cn(
                  "credit-row overview-rise group grid grid-cols-[2rem_40px_minmax(0,1fr)_auto] items-center gap-x-2.5 border-b border-line py-3 sm:grid-cols-[2.5rem_44px_minmax(0,1fr)_auto] sm:gap-x-3.5",
                  person.id === myId && "bg-accent-soft/60",
                )}
                style={vars({ "--i": index + 2, "--share": Math.max(0.04, person.helped / lead) })}
                data-rank-row={person.id}
              >
                <span
                  className={cn(
                    "justify-self-center px-1 text-center font-display leading-none font-bold tracking-[-0.02em] [font-variant-numeric:lining-nums_tabular-nums]",
                    top ? "text-[30px] text-ink" : "text-xl text-faint",
                    first && "head-mark",
                  )}
                >
                  {place}
                </span>
                <span className={cn("credit-face relative rounded-full", first && "credit-face-lead")}>
                  <Avatar id={person.id} name={person.name} version={person.avatar} size={44} className="max-sm:size-10" />
                </span>
                <span className="grid min-w-0 gap-1.5">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <b className="min-w-0 truncate text-[15px]">{nameOf(person)}</b>
                    <small className="shrink-0 text-xs text-faint [font-variant-numeric:tabular-nums]" data-rank-helped>
                      {trn("count.meaningHelped", person.helped)}
                    </small>
                  </span>
                  <span className="credit-track relative block h-1 overflow-hidden bg-line" aria-hidden>
                    <span className={cn("credit-bar absolute inset-y-0 left-0 w-full", first ? "bg-mark" : "bg-accent")} />
                  </span>
                </span>
                {refs.length > 0 ? (
                  // A fixed-width column at the row's end, so the row never runs off a phone screen:
                  // at most 3 small covers on a phone and 4 on a wide screen, then "+n" (design system ContributorRank).
                  <span
                    className="credit-covers flex shrink-0 items-center justify-end"
                    aria-label={t("dashboard.rankBooks", { titles: refs.map((ref) => faces.get(ref)?.title).join(", ") })}
                    role="img"
                    data-rank-books
                  >
                    {refs.slice(0, COVERS).map((ref, k) => {
                      const face = faces.get(ref)!;
                      return (
                        <span key={ref} className={cn("credit-cover block w-6 shrink-0 sm:w-[2.1rem]", k >= MOBILE_COVERS && "max-sm:hidden")} style={vars({ "--k": k })} title={face.title}>
                          <BookCover title={face.title} author={face.author} cover={face.coverUrl} look={face.look} whenVisible />
                        </span>
                      );
                    })}
                    {refs.length > MOBILE_COVERS ? (
                      <em className="ml-1.5 text-xs text-faint not-italic [font-variant-numeric:tabular-nums] sm:hidden">+{refs.length - MOBILE_COVERS}</em>
                    ) : null}
                    {refs.length > COVERS ? (
                      <em className="ml-1.5 hidden text-xs text-faint not-italic [font-variant-numeric:tabular-nums] sm:inline">+{refs.length - COVERS}</em>
                    ) : null}
                  </span>
                ) : (
                  <span aria-hidden />
                )}
              </li>
            );
          })}
        </ol>
      ) : null}

      {rest.length > 0 ? (
        <div className="grid gap-4">
          <button
            type="button"
            className="min-h-11 justify-self-center rounded border border-edge px-5 text-sm font-bold transition-colors hover:bg-sheet"
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
                  style={vars({ "--i": Math.min(index, 12) })}
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

      <HowToHelp delay={listed.length + 2} />
    </section>
  );
}

/**
 * A small looping picture of how a meaning gets in: a word in a sentence is tapped, its card opens,
 * the reader writes a meaning, and after review their name is on it. Decorative (aria-hidden); the
 * three steps under it say the same in words.
 */
function HowToHelp({ delay }: { delay: number }) {
  const { t } = useT();
  return (
    <figure className="overview-rise m-0 grid gap-6 rounded-2xl bg-sheet px-5 py-6 sm:grid-cols-2 sm:items-center sm:gap-8 sm:px-8 sm:py-7" style={vars({ "--i": delay })} data-rank-howto>
      <figcaption className="grid gap-3">
        <p className="m-0 font-display text-[21px] leading-snug font-semibold">{t("dashboard.howTitle")}</p>
        <ol className="m-0 grid list-none gap-2 p-0 text-sm leading-relaxed text-muted">
          {(["dashboard.howStep1", "dashboard.howStep2", "dashboard.howStep3"] as const).map((key, index) => (
            <li key={key} className="flex gap-2.5">
              <span className="shrink-0 font-display font-semibold text-accent [font-variant-numeric:lining-nums_tabular-nums]">{index + 1}.</span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ol>
        <p className="m-0 text-[13px] leading-relaxed text-warn" data-rank-english-only>
          {t("dashboard.howEnglishOnly")}
        </p>
      </figcaption>
      <div className="help-demo relative mx-auto w-full max-w-[19rem] select-none" aria-hidden>
        <p className="m-0 font-display text-[17px] leading-8">
          The boats waited in the quiet <span className="help-demo-word relative">harbor</span> for the tide.
        </p>
        <div className="help-demo-card mt-3 grid gap-2 rounded-card border border-line bg-card px-4 py-3.5 shadow-pop">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-xl font-semibold">harbor</span>
            <MessageCircleQuestion className="help-demo-ask size-4 text-muted" />
          </div>
          <div className="min-h-[38px] rounded border border-edge bg-paper px-2.5 py-2 text-sm">
            <span className="help-demo-type block overflow-hidden whitespace-nowrap">{DEMO_MEANING}</span>
          </div>
          <div className="help-demo-done flex items-center gap-1.5 text-[13px] font-bold text-accent">
            <Check className="size-4" strokeWidth={2.4} />
            {t("dashboard.howDemoDone")}
          </div>
        </div>
      </div>
    </figure>
  );
}
