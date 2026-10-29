import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { SpeakButton } from "@/components/ui";
import { createIpaLookup, type IpaMatch, type IpaReading } from "@/lib/local-ipa";
import { version, loaders } from "virtual:local-ipa-data";

const lookupLocalIpa = createIpaLookup(async () => ({ version, loaders }));

/**
 * Start loading the pronunciation shards a chapter's words need, before any word is tapped. Each
 * shard is one first letter, 40-90 KB on the wire; fetched on the tap it arrived about a second after
 * the card. Call with the chapter's text; only letters that start a word are asked for.
 */
export function warmIpaFor(text: string): void {
  if (!version) return;
  // Most frequent first letters first: they cover most taps, and the warm-up loads one at a time.
  const counts = new Map<string, number>();
  // exec in a loop, not matchAll: the e-ink readers run Chrome 69 (matchAll is 73).
  const first = /\b([A-Za-z])/g;
  for (let match = first.exec(text); match; match = first.exec(text)) {
    const letter = (match[1] ?? "").toLowerCase();
    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }
  lookupLocalIpa.warm([...counts.entries()].sort((a, b) => b[1] - a[1]).map(([letter]) => letter));
}

type LoadState = { word: string; status: "loading" | "ready" | "missing" | "error"; result?: IpaMatch };

function Reading({ reading, derived }: { reading: IpaReading; derived: boolean }) {
  const { t } = useT();
  return (
    <span className="break-words" lang="en" data-ipa-reading data-ipa-derived={derived || undefined}>
      {/* Worked out from the base word by a regular ending, not read from a dictionary. */}
      {derived ? <span className="mr-0.5 text-muted" title={t("ipa.derived")} aria-label={t("ipa.derived")}>≈</span> : null}
      /{reading.ipa}/
    </span>
  );
}

/** What is known about `word` without waiting: drawn on the card's first frame when the shard is here. */
function initial(word: string, also?: string): LoadState {
  const now = lookupLocalIpa.now(word, also);
  if (now === undefined) return { word, status: "loading" };
  return now ? { word, status: "ready", result: now } : { word, status: "missing" };
}

/**
 * The pronunciation rows (design system WordCard / SpeakButton): "UK /ˈhɑːbə/ 🔊" and "US …", each
 * row one button that speaks the displayed word, never the IPA text. Both rows are always drawn, so
 * the card keeps one height: while the pronunciation loads, a faint bar holds the reading's place.
 * `pending`: the card has not decided yet whether this is a word or a phrase; the rows stay, silent.
 * `phrase`: a phrase has no reading here; each row is its label and the speaker.
 */
export function WordIpa({
  word,
  surface,
  pending = false,
  phrase = false,
}: {
  word: string;
  surface?: string;
  pending?: boolean;
  phrase?: boolean;
}) {
  const { t } = useT();
  // The tapped spelling, tried when the list's key has no reading (perhap is the key for perhaps).
  const also = surface?.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "") || undefined;
  const [loaded, setLoaded] = useState<LoadState>(() => (phrase ? { word, status: "missing" } : initial(word, also)));
  useEffect(() => {
    if (phrase) return;
    let current = true;
    const known = initial(word, also);
    setLoaded(known);
    if (known.status !== "loading") return;
    lookupLocalIpa(word, also).then(result => {
      if (current) setLoaded(result ? { word, status: "ready", result } : { word, status: "missing" });
    }).catch(() => {
      if (current) setLoaded({ word, status: "error" });
    });
    return () => { current = false; };
  }, [word, also, phrase]);
  const state = phrase ? ({ word, status: "missing" } as LoadState) : loaded.word === word ? loaded : initial(word, also);
  return (
    <section className="word-ipa grid min-w-0 gap-1" aria-label={t("ipa.title")} aria-busy={state.status === "loading" || undefined} data-word-ipa data-ipa-word={word} data-ipa-status={state.status} data-phrase-audio={phrase || undefined}>
      <div className="word-ipa-values">
        {(["UK", "US"] as const).map(locale => {
          const reading = state.status === "ready" ? state.result?.entry[locale][0] : undefined;
          const content = (
            <>
              <small className="shrink-0 text-xs font-bold text-faint">{t(locale === "UK" ? "ipa.uk" : "ipa.us")}</small>
              {reading ? (
                <span className="min-w-0"><Reading reading={reading} derived={reading.derived === true} /></span>
              ) : phrase ? null : state.status === "loading" ? (
                // Same line height as a reading, so the row does not grow when it arrives.
                <span className="block h-[1.2em] w-[3.5em] max-w-full rounded-sm bg-line/70" aria-hidden data-ipa-placeholder />
              ) : (
                <span className="text-xs text-faint">{t("ipa.unavailable")}</span>
              )}
            </>
          );
          return (
            <div key={locale} className="word-ipa-locale" data-ipa-locale={locale} data-phrase-accent={phrase ? locale : undefined}>
              {pending ? (
                // The same row, silent, until the card knows what it speaks.
                <span className="inline-flex h-9 items-center gap-1.5 px-2" aria-hidden>
                  {content}
                  <span className="word-ipa-speak-slot" />
                </span>
              ) : (
                <SpeakButton text={state.status === "ready" && state.result ? state.result.word : word} accent={locale}>
                  {content}
                </SpeakButton>
              )}
            </div>
          );
        })}
      </div>
      {/* One reserved line for a problem only. A missing word says so in its rows ("Not available"). */}
      {state.status === "error" ? (
        <p className="text-xs text-faint" role="status">{t("ipa.failed")}</p>
      ) : null}
    </section>
  );
}
