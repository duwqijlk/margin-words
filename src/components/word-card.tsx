import { BookMarked, Check, Image as ImageIcon, Sparkles, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import merriamWebsterLogo from "@/assets/merriam-webster-logo.png";
import { countSurface, type OtherMeaning } from "@/lib/glossary-format";
import { useT, type Key } from "@/lib/i18n";
import { LOOKUP_SITES, lookupUrl, type LookupSite } from "@/lib/lookup-links";
import { surfaceOffset } from "@/lib/text";
import { FloatingAside } from "@/components/floating-card";
import { SIDE_PANEL } from "@/components/side-panel";
import { btn, cn, Highlighted, SpeakButton } from "@/components/ui";
import { WordExplanationFeedback } from "@/components/word-feedback";
import { WordIpa } from "@/components/word-ipa";
import { version as localIpaVersion } from "virtual:local-ipa-data";

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
  saved,
  phrase,
  targetMode,
  phrasePending,
  onTargetChange,
  selectionId,
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
  targetMode: "phrase" | "word";
  phrasePending: boolean;
  onTargetChange: (mode: "phrase" | "word") => void;
  selectionId: number;
  canSave: boolean;
  bookId: string;
  bookTitle?: string;
  chapter: number;
  noteChapter?: number | string;
  noList: boolean;
  saved: boolean;
  anchor: HTMLElement | null;
  onClose: (restoreFocus?: boolean) => void;
  onToggle: () => void;
}) {
  const { t } = useT();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const activePhrase = targetMode === "phrase" ? phrase : null;
  const target = activePhrase?.key ?? state.key;
  const targetSurface = activePhrase?.matched ?? state.surface;
  const targetPos = activePhrase ? activePhrase.entry.pos : state.pos;
  const targetHere = activePhrase ? activePhrase.entry.here : state.here;
  const targetMeaning = activePhrase ? activePhrase.entry.meaning : state.meaning;
  const targetForm = activePhrase
    ? activePhrase.matched.toLowerCase() !== activePhrase.key.toLowerCase() ? activePhrase.matched : ""
    : state.key !== state.surface.toLowerCase()
      ? state.surface
      : "";
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    for (const details of body.querySelectorAll("details")) details.open = false;
    body.scrollTop = 0;
  }, [selectionId, targetMode, target]);
  const noMeaning =
    !activePhrase && state.status === "unknown" ? (
      <p
        className="rounded-lg bg-accent-soft px-3 py-2.5 text-[0.95rem] leading-snug"
        role="status"
        data-part="no-meaning"
      >
        {t("card.noMeaning")}
        {noList ? <span className="mt-1 block text-muted">{t("card.noList")}</span> : null}
      </p>
    ) : null;

  const heroMeaning = noMeaning ?? (
    <p
      className="border-l-[3px] border-accent pl-3 text-[1.3rem] leading-snug font-medium text-ink"
      lang="en"
      data-part="word-meaning"
    >
      {targetMeaning}
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
  const formLine = targetForm;
  return (
    <FloatingAside
      anchor={anchor}
      onClose={onClose}
      label={t("card.aria", { word: target })}
      kind="word"
      desktopWidth={24 * 16}
      className={cn(
        "scroll-thin fixed z-40 overflow-y-auto overscroll-contain border-line bg-card px-5 text-ink shadow-pop",
        targetHere ? "word-sheet-context" : "word-sheet-plain",
        "inset-x-0 bottom-0 rounded-t-3xl border-t pt-3.5 pb-5 md:pb-6",
        SIDE_PANEL,
      )}
    >
      <div data-word-header>
        <div className="word-sheet-handle md:hidden" data-sheet-handle aria-hidden>
          <div className="h-1 w-10 rounded-full bg-line" />
        </div>
        <div
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3"
          data-word-head
        >
          <div className="min-w-0" data-word-title>
            <h2
              className="min-w-0 font-display text-[1.85rem] leading-tight font-semibold tracking-tight break-words text-ink"
              lang="en"
            >
              {target}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2" data-word-actions>
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
              aria-label={t(saved ? "card.savedTarget" : "card.addTarget", { word: target })}
              title={t(saved ? "card.savedTarget" : "card.addTarget", { word: target })}
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
              className={cn(btn.icon, "shrink-0")}
              onClick={() => onClose(true)}
              aria-label={t("card.close")}
              data-panel-close
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        </div>
        {phrase ? (
          <div
            className="mt-2 inline-flex w-fit max-w-full items-center rounded-lg border border-line/60 bg-paper p-0.5 text-xs"
            role="group"
            aria-label={t("card.lookTargetAria")}
            data-look-target-group
          >
            <button
              type="button"
              onClick={() => onTargetChange("phrase")}
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
              onClick={() => onTargetChange("word")}
              aria-pressed={targetMode === "word"}
              className={cn(
                "rounded-md px-2 py-0.5 text-[0.72rem] transition-colors",
                targetMode === "word"
                  ? "bg-card text-ink font-semibold shadow-xs"
                  : "text-muted hover:text-ink",
              )}
              data-look-target="word"
              lang="en"
            >
              {state.key}
            </button>
          </div>
        ) : null}
        <div className="mt-2 flex min-w-0 items-center gap-3" data-word-tools>
          <div className="grid min-w-0 gap-0.5" data-word-meta>
            {activePhrase ? (
              <span className={wordPosClass()} data-phrase-pos data-word-pos>
                {activePhrase.entry.pos ? (
                  <span lang="en">{activePhrase.entry.pos}</span>
                ) : (
                  t("card.phraseFallback")
                )}
              </span>
            ) : targetPos ? (
              <span className={wordPosClass()} data-word-pos>
                <span lang="en">{targetPos}</span>
              </span>
            ) : state.status === "easy" ? (
              <span className={wordPosClass(true)} data-word-pos>
                {t("card.easyChip")}
              </span>
            ) : null}
            {formLine ? <p className="text-xs text-muted">{inBook(formLine)}</p> : null}
          </div>
          {!localIpaVersion && !activePhrase ? <SpeakButton text={target} compact className="shrink-0" /> : null}
        </div>
      </div>
      <div ref={bodyRef} className="scroll-thin my-3.5" data-word-body>
        <div className="grid gap-3.5" data-word-content>
          {activePhrase ? (
            <div className="flex flex-wrap items-start gap-x-5 text-sm leading-relaxed" data-phrase-audio>
              {(["UK", "US"] as const).map(accent => (
                <div key={accent} className="inline-flex items-center gap-1.5" data-phrase-accent={accent}>
                  <span className="text-xs font-semibold text-muted">{t(accent === "UK" ? "ipa.uk" : "ipa.us")}</span>
                  <SpeakButton text={target} accent={accent} compact />
                </div>
              ))}
            </div>
          ) : localIpaVersion && !phrasePending ? <WordIpa key={`${selectionId}:${state.key}`} word={state.key} /> : null}
          <div className="grid gap-2" data-word-primary>
            {activePhrase ? (
              <p
                className="border-l-[3px] border-accent pl-3 text-[1.25rem] leading-snug font-medium text-ink"
                lang="en"
                data-part="phrase-meaning"
              >
                {activePhrase.entry.meaning}
              </p>
            ) : heroMeaning}
            {targetHere ? <SceneLine text={targetHere} /> : null}
            {activePhrase?.entry.example ? (
              <CardQuote label={t("card.example")} part="example">
                <Highlighted sentence={activePhrase.entry.example} surface={targetSurface} />
              </CardQuote>
            ) : null}
            {!activePhrase && state.coined ? <CoinedBadge /> : null}
          </div>

        </div>
      </div>
      <div className="space-y-2 border-t border-line/60 pt-3" data-word-footer>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.72rem] font-semibold tracking-wider text-muted uppercase">
            {t("card.lookTitle")}
          </span>
          {state.status !== "unknown" || activePhrase ? (
            <WordExplanationFeedback
              key={`${bookId}:${selectionId}:${targetMode}:${target}:${state.chapter ?? chapter}:${state.occurrence ?? 1}`}
              bookId={bookId}
              bookTitle={bookTitle}
              word={target}
              form={activePhrase ? activePhrase.matched.toLowerCase() : countSurface(state.surface)}
              chapter={state.chapter ?? (typeof noteChapter === "number" ? noteChapter : chapter)}
              occurrence={state.occurrence ?? 1}
              paragraph={state.paragraph ?? 0}
              context={state.context ?? ""}
              sentence={state.fullSentence ?? state.sentence}
              senseIndex={activePhrase ? -1 : state.senseIndex ?? -1}
              senseMeaning={targetMeaning}
              glossaryRev={state.glossaryRev}
            />
          ) : null}
        </div>
        <LookupLinks word={target} />
      </div>
    </FloatingAside>
  );
}
