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
import { MessageCircleQuestion } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Avatar } from "@/components/avatar";
import { BookCover, type CoverLook } from "@/components/book-cover";
import { cn } from "@/components/ui";
import { useAccount } from "@/lib/account-store";
import type { BookMaintainers, Contributor } from "@/lib/contributors";
import { trn, useT } from "@/lib/i18n";
import { groupDigits } from "@/lib/library-totals";

/** What a cover needs, keyed by catalog reference (`word-lists:<id>` or `public-books:<id>`). */
export type BookFace = { title: string; author: string; coverUrl?: string; look: CoverLook };

const vars = (values: Record<string, string | number>) => values as CSSProperties;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : true;
}

/** Counts from 0 to `value` once (about a second, easing out). Shows the value at once when motion is reduced. */
function useCountUp(value: number): number {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  const from = useRef(0);
  useEffect(() => {
    if (reducedMotion() || typeof requestAnimationFrame !== "function") {
      setShown(value);
      return;
    }
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 1100);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(begin + (value - begin) * eased);
      setShown(next);
      from.current = next;
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return shown;
}

/* ------------------------------------------------------------------------------------------------ */
/* Contributors                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

const LISTED = 10;
const COVERS = 4;
/** On a phone the row stays one line: fewer, smaller covers at its end. */
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
  const counted = useCountUp(total);
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
        <div className="overview-rise grid gap-2 px-1" data-rank-hero>
          <p className="font-bold tracking-[-0.02em] text-[3.4rem] leading-none tabular-nums sm:text-[5rem]">
            <span className="overview-mark" aria-hidden>{groupDigits(counted)}</span>
            <span className="sr-only">{groupDigits(total)}</span>
          </p>
          <p className="max-w-md text-[0.95rem] leading-7 text-muted sm:text-base">
            {t("dashboard.rankHero", { people: groupDigits(people.length), books: groupDigits(bookCount) })}
          </p>
        </div>
      ) : (
        <p className="overview-rise px-1 pt-4 font-bold tracking-[-0.02em] text-2xl leading-snug sm:text-3xl" data-rank-empty>
          {t("dashboard.rankEmpty")}
        </p>
      )}

      {signedIn ? (
        <p className="overview-rise -mt-3 px-1 text-sm leading-6 text-muted" style={vars({ "--i": 1 })} data-rank-mine>
          {me ? (
            <>
              <span className="font-semibold text-ink">{t("dashboard.rankMinePlace", { place: me.rank ?? mine + 1 })}</span>
              {" · "}
              {t("dashboard.rankMineCount", { n: me.helped })}
            </>
          ) : (
            t("dashboard.rankMineNoneShort")
          )}
        </p>
      ) : null}

      {listed.length > 0 ? (
        <ol className="grid gap-2" aria-label={t("dashboard.rankTitle")} data-rank-list>
          {listed.map((person, index) => {
            const place = person.rank ?? index + 1;
            const refs = (helpedBooks.get(person.id) ?? []).filter((ref) => faces.has(ref));
            const first = index === 0;
            return (
              <li
                key={person.id}
                className={cn(
                  "credit-row overview-rise group grid grid-cols-[1.25rem_auto_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-2xl px-2.5 py-3 sm:grid-cols-[2.5rem_auto_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-4 sm:py-3.5",
                  first ? "bg-card shadow-sm ring-1 ring-line/70" : "hover:bg-card/70",
                  person.id === myId && "ring-2 ring-accent/40",
                )}
                style={vars({ "--i": index + 2, "--share": Math.max(0.04, person.helped / lead) })}
                data-rank-row={person.id}
              >
                <span
                  className={cn(
                    "text-right font-bold tracking-[-0.02em] tabular-nums leading-none",
                    first ? "text-2xl font-semibold sm:text-3xl" : "text-lg text-muted sm:text-xl",
                  )}
                >
                  {place}
                </span>
                <span className={cn("credit-face relative rounded-full", first && "credit-face-lead")}>
                  <Avatar id={person.id} name={person.name} version={person.avatar} size={first ? 48 : 40} />
                </span>
                <span className="grid min-w-0 gap-1.5">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className={cn("min-w-0 truncate font-semibold", first ? "text-[0.95rem] sm:text-base" : "text-sm")}>{nameOf(person)}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted" data-rank-helped>
                      {trn("count.meaningHelped", person.helped)}
                    </span>
                  </span>
                  <span className="credit-track relative block h-1.5 overflow-hidden rounded-full bg-line/60" aria-hidden>
                    <span className="credit-bar absolute inset-y-0 left-0 w-full rounded-full bg-accent" />
                  </span>
                </span>
                {refs.length > 0 ? (
                  <span
                    className="credit-covers flex w-[4.5rem] items-center justify-end sm:w-[9.5rem]"
                    aria-label={t("dashboard.rankBooks", { titles: refs.map((ref) => faces.get(ref)?.title).join(", ") })}
                    role="img"
                  >
                    {refs.slice(0, COVERS).map((ref, k) => {
                      const face = faces.get(ref)!;
                      return (
                        <span key={ref} className={cn("credit-cover block w-6 sm:w-9", k >= MOBILE_COVERS && "max-sm:hidden")} style={vars({ "--k": k })} title={face.title}>
                          <BookCover title={face.title} author={face.author} cover={face.coverUrl} look={face.look} whenVisible />
                        </span>
                      );
                    })}
                    {refs.length > MOBILE_COVERS ? (
                      <span className="ml-1.5 text-[0.7rem] tabular-nums text-muted sm:hidden">+{refs.length - MOBILE_COVERS}</span>
                    ) : null}
                    {refs.length > COVERS ? (
                      <span className="ml-2 hidden text-xs tabular-nums text-muted sm:inline">+{refs.length - COVERS}</span>
                    ) : null}
                  </span>
                ) : (
                  <span className="block w-[4.5rem] sm:w-[9.5rem]" aria-hidden />
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
            className="justify-self-center rounded border border-line px-5 py-2 text-sm font-medium transition-colors hover:bg-card"
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
    <figure className="overview-rise grid gap-5 rounded-3xl border border-line/70 px-5 py-6 sm:grid-cols-[1fr_1.1fr] sm:items-center sm:gap-8 sm:px-8 sm:py-8" style={vars({ "--i": delay })} data-rank-howto>
      <div className="help-demo relative mx-auto w-full max-w-[19rem] select-none" aria-hidden>
        <p className="font-display text-[1.05rem] leading-8">
          The boats waited in the quiet <span className="help-demo-word relative">harbor</span> for the tide.
        </p>
        <div className="help-demo-card mt-3 grid gap-2.5 rounded-2xl border border-line bg-card p-3.5 shadow-lift">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-lg font-semibold">harbor</span>
            <MessageCircleQuestion className="help-demo-ask size-4 text-muted" />
          </div>
          <div className="rounded-xl bg-paper px-3 py-2 text-sm">
            <span className="help-demo-type block overflow-hidden whitespace-nowrap">{DEMO_MEANING}</span>
          </div>
          <div className="help-demo-done flex items-center gap-1.5 text-xs text-muted">
            <span className="grid size-5 place-items-center rounded-full bg-accent text-[0.6rem] font-bold text-accent-ink">✓</span>
            {t("dashboard.howDemoDone")}
          </div>
        </div>
      </div>
      <figcaption className="grid gap-3">
        <p className="font-bold tracking-[-0.02em] text-xl leading-snug">{t("dashboard.howTitle")}</p>
        <ol className="grid gap-2 text-sm leading-6 text-muted">
          {(["dashboard.howStep1", "dashboard.howStep2", "dashboard.howStep3"] as const).map((key, index) => (
            <li key={key} className="flex gap-2.5">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-line text-[0.7rem] font-semibold tabular-nums text-ink">
                {index + 1}
              </span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ol>
        <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm leading-6 text-warn" data-rank-english-only>
          {t("dashboard.howEnglishOnly")}
        </p>
      </figcaption>
    </figure>
  );
}
