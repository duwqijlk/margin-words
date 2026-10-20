import { BookMarked, Check, ChevronRight, Image as ImageIcon, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import merriamWebsterLogo from "@/assets/merriam-webster-logo.png";
import { countSurface, type OtherMeaning } from "@/lib/glossary-format";
import { useT, type Key } from "@/lib/i18n";
import { LOOKUP_SITES, lookupUrl, type LookupSite } from "@/lib/lookup-links";
import { surfaceOffset, type WordStat } from "@/lib/text";
import { FloatingAside } from "@/components/floating-card";
import { ExplainSentence } from "@/components/help-panels";
import { SIDE_PANEL } from "@/components/side-panel";
import { btn, cn, Highlighted, SpeakButton } from "@/components/ui";
import { WordExplanationFeedback } from "@/components/word-feedback";

/** One quiet quote: a small optional label and a serif line with a thin left rule. */
export function CardQuote({
  label,
  part,
  children,
}: {
  label?: string;
  part?: string;
  children: ReactNode;
}) {
  return (
    <figure
      className="grid gap-0.5 border-l-2 border-line pl-3"
      {...(part ? { "data-part": part } : {})}
    >
      {label ? (
        <figcaption className="text-[0.7rem] font-semibold tracking-wide text-muted uppercase">
          {label}
        </figcaption>
      ) : null}
      <blockquote className="font-display text-[0.92rem] leading-relaxed text-ink/85">
        {children}
      </blockquote>
    </figure>
  );
}

export function WordFacts({
  stat,
  current,
  suppressQuote = false,
}: {
  stat: WordStat | undefined;
  current: string;
  suppressQuote?: boolean;
}) {
  const { t, tn } = useT();
  if (!stat) return null;
  const others = suppressQuote
    ? []
    : stat.sentences.filter((sentence) => sentence !== current).slice(0, 1);
  const other = others[0];
  const facts = (
    <>
      {tn("facts.seen", stat.count)}
      {stat.chapters > 1 ? t("facts.chapters", { n: stat.chapters }) : ""}
      {stat.forms.length > 1 ? (
        <>
          {t("facts.forms")}
          <span lang="en">
            {stat.forms.map((form) => `${form.form} ×${form.count}`).join(", ")}
          </span>
        </>
      ) : null}
    </>
  );
  return (
    <div className="text-xs leading-relaxed text-muted">
      {other ? (
        <details className="group">
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1 select-none marker:hidden hover:text-ink">
            <ChevronRight
              className="size-3 shrink-0 transition-transform group-open:rotate-90"
              aria-hidden
            />
            <span>{facts}</span>
          </summary>
          <CardQuote>
            <span lang="en">“{other}”</span>
          </CardQuote>
        </details>
      ) : (
        <p>{facts}</p>
      )}
    </div>
  );
}

export function OtherMeanings({ items }: { items: OtherMeaning[] }) {
  const { t, tn } = useT();
  return (
    <details className="group rounded-lg bg-paper px-3 py-2 text-sm">
      <summary className="cursor-pointer list-none font-semibold text-muted select-none marker:hidden hover:text-ink">
        <span className="inline-flex items-center gap-1.5">
          <ChevronRight
            className="size-3.5 transition-transform group-open:rotate-90"
            aria-hidden
          />
          {t("other.title", { n: items.length })}
        </span>
      </summary>
      <ul className="mt-2 grid gap-2.5">
        {items.map((item) => (
          <li key={item.meaning} className="grid gap-0.5" lang="en">
            <span className="text-xs text-muted">
              {item.pos ? `${item.pos}` : t("other.another")}
              {item.chapters.length > 0
                ? ` · ${tn("other.chapters", item.chapters.length, {
                    list: item.chapters
                      .slice(0, 4)
                      .map((c) => c + 1)
                      .join(", "),
                  })}`
                : ""}
            </span>
            <span className="leading-snug">{item.meaning}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export type CardState = {
  surface: string;
  key: string;
  pos: string;
  meaning: string;
  whyHard: string;
  here?: string;
  sentence: string;
  ready: boolean;
  status: "ready" | "easy" | "unknown";
  others?: OtherMeaning[];
  coined?: boolean;
  fullSentence?: string;
  example?: string;
  senseIndex?: number;
  context?: string;
  occurrence?: number;
  paragraph?: number;
  chapter?: number;
  glossaryRev?: string;
};

/** The whole sentence around a tapped word, and where that word starts inside it. */
export function locateSentence(
  paragraph: string,
  surface: string,
  at: number,
): { text: string; offset: number } {
  const idx = surfaceOffset(paragraph, surface, at);
  if (idx < 0) return { text: paragraph.slice(0, 600), offset: -1 };
  let start = 0;
  let end = paragraph.length;
  for (const mark of [".", "?", "!"]) {
    const a = paragraph.lastIndexOf(mark, idx - 1);
    if (a >= 0) start = Math.max(start, a + 1);
    const z = paragraph.indexOf(mark, idx + surface.length);
    if (z >= 0) end = Math.min(end, z + 1);
  }
  const raw = paragraph.slice(start, end);
  const lead = raw.length - raw.trimStart().length;
  return { text: raw.trim(), offset: idx - start - lead };
}

/** The whole sentence around a tapped word (not shortened). */
export function wholeSentence(paragraph: string, surface: string, at: number): string {
  return locateSentence(paragraph, surface, at).text;
}

export type PhraseHit = {
  key: string;
  entry: { meaning: string; pos?: string; example?: string; here?: string };
  matched: string;
};

export function wordPosClass(quiet = false) {
  return cn(
    "inline-flex max-w-full items-center leading-none",
    quiet
      ? "rounded-full bg-line px-2.5 py-1 text-xs font-semibold text-ink"
      : "font-display text-[1.05rem] font-semibold text-accent italic",
  );
}

export function SceneLine({ text }: { text: string }) {
  const { t } = useT();
  return (
    <section className="grid gap-1 py-1" data-part="word-here">
      <h3 className="text-[0.7rem] font-semibold tracking-wide text-accent uppercase">
        {t("card.here")}
      </h3>
      <p className="text-[0.98rem] leading-snug" lang="en">
        {text}
      </p>
    </section>
  );
}

const LOOKUP_LABEL = {
  longman: "card.look.longman",
  webster: "card.look.webster",
  images: "card.look.images",
} as const satisfies Record<LookupSite, Key>;

export function LookupLinks({ word }: { word: string }) {
  const { t } = useT();
  return (
    <nav
      className="grid grid-cols-3 gap-2 w-full"
      aria-label={t("card.lookAria", { word })}
      data-word-lookup
    >
      {LOOKUP_SITES.map((site) => (
        <a
          key={site}
          href={lookupUrl(site, word)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-2 text-xs font-semibold text-ink shadow-xs transition-colors hover:border-muted hover:bg-paper"
          aria-label={t("card.lookOne", { site: t(LOOKUP_LABEL[site]), word })}
          title={t(LOOKUP_LABEL[site])}
          data-lookup={site}
        >
          {site === "longman" ? (
            <span className="inline-grid size-4 shrink-0 place-items-center rounded bg-[#314089] text-[0.62rem] font-bold text-white leading-none">
              L
            </span>
          ) : site === "webster" ? (
            <img
              src={merriamWebsterLogo}
              alt=""
              className="size-4 shrink-0 rounded-full"
              aria-hidden
            />
          ) : (
            <ImageIcon className="size-3.5 shrink-0 text-accent" strokeWidth={2} aria-hidden />
          )}
          <span className="truncate">{t(LOOKUP_LABEL[site])}</span>
        </a>
      ))}
    </nav>
  );
}

export function CoinedBadge() {
  const { t } = useT();
  return (
    <p
      className="inline-flex items-center gap-1.5 self-start rounded-full bg-mark/60 px-2.5 py-0.5 text-xs font-semibold text-ink"
      data-coined
    >
      <Sparkles className="size-3" aria-hidden />
      {t("card.coined")}
    </p>
  );
}

export function WordCard({
  state,
  stat,
  saved,
  phrase,
  canSave,
  bookId,
  bookTitle,
  chapter,
  noteChapter,
  noList,
  anchor,
  onClose,
  onToggle,
}: {
  state: CardState;
  phrase: PhraseHit | null;
  canSave: boolean;
  bookId: string;
  bookTitle?: string;
  chapter: number;
  noteChapter?: number | string;
  noList: boolean;
  stat: WordStat | undefined;
  saved: boolean;
  anchor: HTMLElement | null;
  onClose: (restoreFocus?: boolean) => void;
  onToggle: () => void;
}) {
  const { t } = useT();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    for (const details of body.querySelectorAll("details")) details.open = false;
    body.scrollTop = 0;
  }, [anchor, state.key, phrase?.key]);
  const [targetMode, setTargetMode] = useState<"phrase" | "word">("phrase");
  useEffect(() => {
    setTargetMode("phrase");
  }, [anchor, state.key, phrase?.key]);
  const showForm = state.key !== state.surface.toLowerCase();
  const lookup = phrase ? phrase.key : state.key;
  const noMeaning =
    state.status === "unknown" ? (
      <p
        className="rounded-lg bg-accent-soft px-3 py-2.5 text-[0.95rem] leading-snug"
        role="status"
        data-part="no-meaning"
      >
        {t("card.noMeaning")}
        {noList ? <span className="mt-1 block text-muted">{t("card.noList")}</span> : null}
      </p>
    ) : null;

  const meaningBlock = noMeaning ?? (
    <p
      className="border-l-[3px] border-accent pl-3 text-[1.14rem] leading-snug font-medium text-ink"
      lang="en"
      data-part="word-meaning"
    >
      {state.meaning}
    </p>
  );

  const heroMeaning = noMeaning ?? (
    <p
      className="border-l-[3px] border-accent pl-3 text-[1.3rem] leading-snug font-medium text-ink"
      lang="en"
      data-part="word-meaning"
    >
      {state.meaning}
    </p>
  );

  const inBook = (word: string) =>
    t("common.inBook", { word: "\u0001" })
      .split("\u0001")
      .flatMap((piece, i) =>
        i === 0
          ? [piece]
          : [
              <span key="m" className="font-semibold text-ink" lang="en">
                {word}
              </span>,
              piece,
            ],
      );
  const formLine = phrase ? phrase.matched : showForm ? state.surface : "";
  return (
    <FloatingAside
      anchor={anchor}
      onClose={onClose}
      label={t("card.aria", { word: state.key })}
      kind="word"
      desktopWidth={24 * 16}
      className={cn(
        "scroll-thin fixed z-40 overflow-y-auto overscroll-contain border-line bg-card px-5 text-ink shadow-pop",
        state.here || phrase?.entry.here ? "word-sheet-context" : "word-sheet-plain",
        "inset-x-0 bottom-0 rounded-t-3xl border-t pt-3.5 pb-5 md:pb-6",
        SIDE_PANEL,
      )}
    >
      <div data-word-header>
        <div
          className="mx-auto mb-2 h-1 w-10 rounded-full bg-line md:hidden"
          data-sheet-handle
          aria-hidden
        />
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2" data-word-head>
          <div className={cn("grid min-w-0 gap-0.5", phrase ? "w-full" : "flex-1")} data-word-title>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h2
                className="min-w-0 font-display text-[1.85rem] leading-tight font-semibold tracking-tight break-words text-ink"
                lang="en"
              >
                {lookup}
              </h2>
              {phrase ? (
                <span className={wordPosClass()} data-phrase-pos data-word-pos>
                  {phrase.entry.pos ? (
                    <span lang="en">{phrase.entry.pos}</span>
                  ) : (
                    t("card.phraseFallback")
                  )}
                </span>
              ) : state.pos ? (
                <span className={wordPosClass()} data-word-pos>
                  <span lang="en">{state.pos}</span>
                </span>
              ) : state.status === "easy" ? (
                <span className={cn(wordPosClass(true), "self-center")} data-word-pos>
                  {t("card.easyChip")}
                </span>
              ) : null}
            </div>
            {formLine ? <p className="text-xs text-muted">{inBook(formLine)}</p> : null}
          </div>
          <div className="ml-auto flex items-center gap-1 shrink-0 pt-0.5">
            <SpeakButton text={lookup} compact className="shrink-0" />
            <button
              type="button"
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-lg border transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40",
                saved
                  ? "border-accent bg-accent text-accent-ink shadow-xs"
                  : "border-line bg-card text-ink/80 hover:border-muted hover:bg-paper hover:text-ink shadow-2xs",
              )}
              disabled={!saved && !canSave}
              onClick={onToggle}
              aria-pressed={saved}
              aria-label={saved ? t("card.saved") : t("card.add")}
              title={saved ? t("card.saved") : t("card.add")}
              data-word-save
            >
              {saved ? (
                <Check className="size-4.5 stroke-[2.5]" aria-hidden />
              ) : (
                <BookMarked className="size-4.5 stroke-[1.8]" aria-hidden />
              )}
            </button>
            <button
              type="button"
              className={cn(btn.icon, "size-9 shrink-0")}
              onClick={() => onClose(true)}
              aria-label={t("card.close")}
              data-panel-close
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <div ref={bodyRef} className="scroll-thin my-3.5" data-word-body>
        <div className="grid gap-3.5" data-word-content>
          {phrase ? (
            <div className="grid gap-2">
              <p
                className="border-l-[3px] border-accent pl-3 text-[1.25rem] leading-snug font-medium text-ink"
                lang="en"
                data-part="phrase-meaning"
              >
                {phrase.entry.meaning}
              </p>
              {phrase.entry.here ? <SceneLine text={phrase.entry.here} /> : null}
              <details className="word-detail text-sm" data-part="word-alone">
                <summary>{t("card.aloneWord", { word: state.key })}</summary>
                <div className="grid gap-2 pt-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-display font-semibold text-ink" lang="en">
                      {state.key}
                    </span>
                    {state.pos ? (
                      <span className={cn(wordPosClass(), "text-[0.8rem]")} data-word-pos>
                        <span lang="en">{state.pos}</span>
                      </span>
                    ) : null}
                  </div>
                  {meaningBlock}
                  {state.coined ? <CoinedBadge /> : null}
                </div>
              </details>
            </div>
          ) : (
            <div className="grid gap-2">
              {heroMeaning}
              {state.here ? <SceneLine text={state.here} /> : null}
              {state.coined ? <CoinedBadge /> : null}
            </div>
          )}

          {state.sentence ? (
            <details className="word-detail text-sm" data-part="sentence-box">
              <summary>{t("card.sentenceFrom")}</summary>
              <div className="mt-2.5 grid gap-2.5 pt-1">
                <blockquote className="font-display text-[0.92rem] leading-relaxed text-ink/90">
                  <Highlighted
                    sentence={state.sentence}
                    surface={phrase ? phrase.matched : state.surface}
                  />
                </blockquote>
                <ExplainSentence
                  key={`${noteChapter ?? chapter}|${state.sentence}`}
                  bookId={bookId}
                  chapter={noteChapter ?? chapter}
                  sentence={state.fullSentence || state.sentence}
                />
              </div>
            </details>
          ) : null}

          {state.example ||
          (state.whyHard && state.ready && state.status === "ready") ||
          (state.others && state.others.length > 0 && state.status === "ready") ||
          stat ? (
            <details className="word-detail text-sm" data-part="word-more">
              <summary>{t("card.more")}</summary>
              <div className="grid gap-2.5 pt-2">
                {state.example ? (
                  <CardQuote label={t("card.example")} part="example">
                    <Highlighted sentence={state.example} surface={state.surface} />
                  </CardQuote>
                ) : null}

                {state.whyHard && state.ready && state.status === "ready" ? (
                  <p className="text-xs leading-relaxed text-muted" lang="en">
                    <span className="font-semibold text-ink/75">{t("card.whyHard")} </span>
                    {state.whyHard}
                  </p>
                ) : null}

                {state.others && state.others.length > 0 && state.status === "ready" ? (
                  <OtherMeanings items={state.others} />
                ) : null}

                <WordFacts
                  stat={stat}
                  current={state.sentence}
                  suppressQuote={Boolean(state.example)}
                />
              </div>
            </details>
          ) : null}

          {state.status !== "unknown" || phrase ? (
            <WordExplanationFeedback
              key={`${bookId}:${lookup}:${state.chapter ?? chapter}:${state.occurrence ?? 1}`}
              bookId={bookId}
              bookTitle={bookTitle}
              word={lookup}
              form={countSurface(state.surface)}
              chapter={state.chapter ?? (typeof noteChapter === "number" ? noteChapter : chapter)}
              occurrence={state.occurrence ?? 1}
              paragraph={state.paragraph ?? 0}
              context={state.context ?? ""}
              sentence={state.fullSentence ?? state.sentence}
              senseIndex={state.senseIndex ?? -1}
              senseMeaning={phrase ? phrase.entry.meaning : state.meaning}
              glossaryRev={state.glossaryRev}
            />
          ) : null}
        </div>
      </div>
      <div className="space-y-2 border-t border-line/60 pt-3" data-word-footer>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.72rem] font-semibold tracking-wider text-muted uppercase">
            {t("card.lookTitle")}
          </span>
          {phrase ? (
            <div
              className="inline-flex items-center rounded-lg bg-paper p-0.5 text-xs border border-line/60"
              role="group"
              aria-label={t("card.lookTitle")}
              data-look-target-group
            >
              <button
                type="button"
                onClick={() => setTargetMode("phrase")}
                aria-pressed={targetMode === "phrase"}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[0.72rem] transition-colors",
                  targetMode === "phrase"
                    ? "bg-card text-ink font-semibold shadow-xs"
                    : "text-muted hover:text-ink",
                )}
                data-look-target="phrase"
              >
                {t("card.lookTargetPhrase")}
              </button>
              <button
                type="button"
                onClick={() => setTargetMode("word")}
                aria-pressed={targetMode === "word"}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[0.72rem] transition-colors",
                  targetMode === "word"
                    ? "bg-card text-ink font-semibold shadow-xs"
                    : "text-muted hover:text-ink",
                )}
                data-look-target="word"
              >
                {state.key}
              </button>
            </div>
          ) : null}
        </div>
        <LookupLinks word={phrase && targetMode === "phrase" ? phrase.key : state.key} />
      </div>
    </FloatingAside>
  );
}
