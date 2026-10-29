import { Heart, Image as ImageIcon, Sparkles, X } from "lucide-react";
import { useEffect, useRef } from "react";
import merriamWebsterLogo from "@/assets/merriam-webster-logo.png";
import { countSurface, type OtherMeaning } from "@/lib/glossary-format";
import { useT, type Key } from "@/lib/i18n";
import { LOOKUP_SITES, lookupUrl, type LookupSite } from "@/lib/lookup-links";
import { surfaceOffset } from "@/lib/text";
import { FloatingAside } from "@/components/floating-card";
import { SentenceHint } from "@/components/help-panels";
import { SIDE_PANEL } from "@/components/side-panel";
import { cn, SpeakButton } from "@/components/ui";
import { WordMeaning } from "@/components/word-feedback";
import { WordIpa } from "@/components/word-ipa";
import { version as localIpaVersion } from "virtual:local-ipa-data";

export type CardState = {
  surface: string;
  key: string;
  pos: string;
  meaning: string;
  whyHard: string;
  here?: string;
  sentence: string;
  ready: boolean;
  status: "ready" | "unknown";
  others?: OtherMeaning[];
  coined?: boolean;
  /** Public id of the reader whose suggested meaning this is. */
  credit?: string;
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
  entry: { meaning: string; pos?: string; example?: string; here?: string; credit?: string };
  matched: string;
};

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
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-ink/[0.05] px-2 text-xs font-medium text-ink transition-colors hover:bg-ink/10"
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
      className="inline-flex items-center gap-1.5 self-start rounded-sm bg-mark px-2 py-0.5 text-xs font-bold text-ink"
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
  chapters,
  catalogId,
  noteChapter,
  noList,
  anchor,
  onClose,
  onToggle,
  onSentenceHelp,
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
  /** How many chapters this copy of the book has (the word list has its own count). */
  chapters?: number;
  /** The catalog book, `<catalog>:<id>` (src/lib/catalog-id.ts); "" for a list the reader added. */
  catalogId?: string;
  noteChapter?: number | string;
  noList: boolean;
  saved: boolean;
  anchor: HTMLElement | null;
  onClose: (restoreFocus?: boolean) => void;
  onToggle: () => void;
  /** Opens the paragraph panel with this sentence's note. Absent: no sentence hint. */
  onSentenceHelp?: () => void;
}) {
  const { t } = useT();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const activePhrase = targetMode === "phrase" ? phrase : null;
  const target = activePhrase?.key ?? state.key;
  const targetMeaning = activePhrase ? activePhrase.entry.meaning : state.meaning;
  // A sentence note belongs to a chapter, or to a recovered extra by its id. The tapped place's
  // own chapter is the reader's edition index; for an extra, that id is the only usable key.
  const sentenceChapter =
    typeof noteChapter === "string" ? noteChapter : (state.chapter ?? noteChapter ?? chapter);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    for (const details of body.querySelectorAll("details")) details.open = false;
    body.scrollTop = 0;
  }, [selectionId, targetMode, target]);
  const report = {
    bookId,
    bookTitle,
    word: target,
    form: activePhrase ? activePhrase.matched.toLowerCase() : countSurface(state.surface),
    chapter: state.chapter ?? (typeof noteChapter === "number" ? noteChapter : chapter),
    chapters,
    catalogId,
    occurrence: state.occurrence ?? 1,
    paragraph: state.paragraph ?? 0,
    context: state.context ?? "",
    sentence: state.fullSentence ?? state.sentence,
    senseIndex: activePhrase ? -1 : state.senseIndex ?? -1,
    senseMeaning: targetMeaning,
    glossaryRev: state.glossaryRev,
  };
  const missing = !activePhrase && state.status === "unknown";
  return (
    <FloatingAside
      anchor={anchor}
      onClose={onClose}
      label={t("card.aria", { word: target })}
      kind="word"
      desktopWidth={24 * 16}
      className={cn(
        "scroll-thin fixed z-40 overflow-y-auto overscroll-contain border-line bg-card px-5 text-ink shadow-pop ",
        "word-sheet-plain",
        "inset-x-0 bottom-0 rounded-t-sheet border-t pt-3.5 pb-5 md:pb-6",
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
            {/* Literata, bold; a word over 14 letters steps down so it stays on one line. */}
            <h2
              className={cn(
                "min-w-0 font-display leading-tight font-bold tracking-[-0.025em] break-words text-ink",
                target.length > 14 ? "text-[1.6rem]" : "text-[1.85rem]",
              )}
              lang="en"
            >
              {target}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2" data-word-actions>
            <button
              type="button"
              className={cn(
                "inline-flex size-11 shrink-0 items-center justify-center rounded transition-colors duration-100 hover:bg-sheet disabled:cursor-not-allowed disabled:opacity-40",
                saved ? "text-accent" : "text-ink/80 hover:text-ink",
              )}
              disabled={!saved && !canSave}
              onClick={onToggle}
              aria-pressed={saved}
              aria-label={t(saved ? "card.savedTarget" : "card.addTarget", { word: target })}
              title={t(saved ? "card.savedTarget" : "card.addTarget", { word: target })}
              data-word-save
            >
              {/* A heart: outline to save, filled brand once the word is in the notebook. */}
              <Heart className={cn("size-5 stroke-[1.8]", saved && "fill-current")} aria-hidden />
            </button>
            <button
              type="button"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded text-faint transition-colors duration-100 hover:bg-sheet hover:text-ink"
              onClick={() => onClose(true)}
              aria-label={t("card.close")}
              data-panel-close
            >
              <X className="size-5 stroke-2" aria-hidden />
            </button>
          </div>
        </div>
        {phrase ? (
          <div
            className="mt-2 inline-flex w-fit max-w-full items-center divide-x divide-line overflow-hidden rounded border border-edge text-xs"
            role="group"
            aria-label={t("card.lookTargetAria")}
            data-look-target-group
          >
            <button
              type="button"
              onClick={() => onTargetChange("phrase")}
              aria-pressed={targetMode === "phrase"}
              className={cn(
                "px-2.5 py-1 text-[0.75rem] transition-colors duration-100",
                targetMode === "phrase" ? "bg-accent-soft font-bold text-accent" : "text-muted hover:bg-sheet hover:text-ink",
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
                "px-2.5 py-1 text-[0.75rem] transition-colors duration-100",
                targetMode === "word" ? "bg-accent-soft font-bold text-accent" : "text-muted hover:bg-sheet hover:text-ink",
              )}
              data-look-target="word"
              lang="en"
            >
              {state.key}
            </button>
          </div>
        ) : null}
        {!localIpaVersion && !activePhrase ? (
          <div className="mt-2 flex min-w-0 items-center gap-3" data-word-tools>
            <SpeakButton text={target} compact className="shrink-0" />
          </div>
        ) : null}
      </div>
      <div ref={bodyRef} className="scroll-thin mt-2.5 mb-4" data-word-body>
        <div className="grid gap-3" data-word-content>
          {activePhrase ? (
            <WordIpa key={`${selectionId}:${target}`} word={target} phrase />
          ) : localIpaVersion ? (
            // Drawn from the first frame, also while the phrase check runs, so the card keeps its
            // height: the IPA used to appear a beat later and push the meaning down under the finger.
            <WordIpa key={`${selectionId}:${state.key}`} word={state.key} surface={state.surface} pending={phrasePending} />
          ) : null}
          {/* The meaning, its credit and the feedback around it (word-feedback.tsx). Only the
              headword, the IPA, the meaning and its credit are shown: no part of speech, no
              "in this sentence" or second example (design system WordCard). */}
          <WordMeaning
            key={`${bookId}:${selectionId}:${targetMode}:${target}:${state.chapter ?? chapter}:${state.occurrence ?? 1}`}
            meaning={targetMeaning}
            credit={activePhrase ? activePhrase.entry.credit : state.status === "ready" ? state.credit : undefined}
            missing={missing}
            noList={noList}
            part={activePhrase ? "phrase-meaning" : "word-meaning"}
            target={report}
          >
            {!activePhrase && state.coined ? <CoinedBadge /> : null}
          </WordMeaning>
          {/* One small line when the word list has a note for this sentence; the note opens in
              the paragraph panel. It shows nothing when there is none. */}
          {onSentenceHelp ? (
            <SentenceHint
              bookId={bookId}
              chapter={sentenceChapter}
              sentence={state.fullSentence ?? state.sentence}
              onOpen={onSentenceHelp}
            />
          ) : null}
        </div>
      </div>
      <div className="grid gap-2 border-t border-line pt-3" data-word-footer>
        <span className="text-xs text-faint">{t("card.lookTitle")}</span>
        <LookupLinks word={target} />
      </div>
    </FloatingAside>
  );
}
