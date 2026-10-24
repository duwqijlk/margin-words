import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { WordCard, type CardState } from "../../src/components/word-card";
import { useLocale } from "../../src/lib/i18n";
import { installPolyfills } from "../../src/lib/polyfills";
import "../../src/styles.css";

installPolyfills();
useLocale.setState({ locale: "zh" });
const samples = ["bath", "water", "world", "does", "book", "bow", "use", "minute", "read", "university", "takin", "winky", "quuxstone"];
const sentence = "The reader put a book beside the bath and looked at the world outside. These are synthetic preview words, not a stored book.";
function App() {
  const [word, setWord] = useState("bath");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"phrase" | "word">("word");
  const [selection, setSelection] = useState(0);
  const [saved, setSaved] = useState(false);
  const anchors = useRef<Record<string, HTMLButtonElement | null>>({});
  const state: CardState = { key: word, surface: word === "winky" ? "Winkies" : word, pos: word === "winky" ? "plural noun" : "n.", meaning: word === "winky" ? "The people who live in the West. They live in the West of Oz." : word === "bath" ? "A large container of water in which you wash your body." : "A synthetic word-card example for checking local pronunciations.", whyHard: "", sentence, ready: true, status: word === "quuxstone" ? "unknown" : "ready" };
  const phrase = word === "bath" ? { key: "bath time", matched: "bath time", entry: { meaning: "The time when someone has a bath.", pos: "n." } } : null;
  return <div className="min-h-screen bg-paper text-ink">
    <header className="border-b border-line p-4">
      <p className="text-sm font-semibold">Local IPA preview — synthetic fixture, no book or account storage</p>
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        <button onClick={() => useLocale.setState({ locale: "zh" })}>Chinese UI</button>
        <button onClick={() => useLocale.setState({ locale: "en" })}>English UI</button>
        <button onClick={() => document.documentElement.dataset.theme = "light"}>Light</button>
        <button onClick={() => document.documentElement.dataset.theme = "dark"}>Dark</button>
        <button onClick={() => document.documentElement.dataset.theme = "sepia"}>Sepia</button>
      </div>
    </header>
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="font-display text-3xl">A quiet reading page</h1>
      <article className="mt-8 font-display text-xl leading-loose" data-ipa-preview-article>
        <p>{sentence}</p>
        <p className="mt-6">Tap a word to open the real reader word card. Pronunciation data loads as a local static asset. Audio and saving are not triggered by opening this fixture.</p>
        <div className="mt-8 flex flex-wrap gap-4">
          {samples.map(sample => <button className="underline decoration-accent underline-offset-4" key={sample} ref={node => { anchors.current[sample] = node; }} onClick={() => { setWord(sample); setMode("word"); setSelection(n => n + 1); setSaved(false); setOpen(true); }}>{sample}</button>)}
        </div>
      </article>
    </main>
    {open ? <WordCard state={state} saved={saved} phrase={phrase} targetMode={mode} phrasePending={false} onTargetChange={setMode} selectionId={selection} canSave={true} bookId="local-ipa-preview" bookTitle="Synthetic preview" chapter={0} noList={false} anchor={anchors.current[word]} onClose={() => setOpen(false)} onToggle={() => setSaved(value => !value)} /> : null}
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
