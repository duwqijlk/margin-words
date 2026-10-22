import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { SpeakButton } from "@/components/ui";
import { createIpaLookup, type IpaMatch, type IpaReading } from "@/lib/local-ipa";
import { version, loaders } from "virtual:local-ipa-data";

const lookupLocalIpa = createIpaLookup(async () => ({ version, loaders }));

type LoadState = { word: string; status: "loading" | "ready" | "missing" | "error"; result?: IpaMatch };

function Reading({ reading }: { reading: IpaReading }) {
  return <span className="break-words" lang="en" data-ipa-reading>/{reading.ipa}/</span>;
}

/** Each accent speaks the displayed word, never the IPA text. */
export function WordIpa({ word }: { word: string }) {
  const { t } = useT();
  const [loaded, setLoaded] = useState<LoadState>({ word, status: "loading" });
  useEffect(() => {
    let current = true;
    setLoaded({ word, status: "loading" });
    lookupLocalIpa(word).then(result => {
      if (current) setLoaded(result ? { word, status: "ready", result } : { word, status: "missing" });
    }).catch(() => {
      if (current) setLoaded({ word, status: "error" });
    });
    return () => { current = false; };
  }, [word]);
  const state = loaded.word === word ? loaded : { word, status: "loading" as const };
  return (
    <section className="word-ipa grid min-w-0 gap-1.5 text-sm leading-relaxed" aria-label={t("ipa.title")} data-word-ipa data-ipa-word={word} data-ipa-status={state.status}>
      {state.status === "ready" && state.result ? (
        <div className="word-ipa-values">
          {(["UK", "US"] as const).map(locale => {
            const values = state.result!.entry[locale];
            return (
              <div key={locale} className="word-ipa-locale" data-ipa-locale={locale}>
                <span className="shrink-0 text-xs font-semibold text-muted">{t(locale === "UK" ? "ipa.uk" : "ipa.us")}</span>
                <div className="min-w-0">
                  {values.length ? <Reading reading={values[0]} /> : <span className="text-xs text-muted">{t("ipa.unavailable")}</span>}
                </div>
                {values.length ? <SpeakButton text={word} accent={locale} compact /> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted" role="status">
          {t(state.status === "loading" ? "ipa.loading" : state.status === "error" ? "ipa.failed" : "ipa.missing")}
        </p>
      )}
    </section>
  );
}
