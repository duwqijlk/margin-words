/** `derived`: worked out from a base word by a regular ending (ipa-derive.ts); the card shows ≈. */
export type IpaReading = Readonly<{ ipa: string; pos?: string; derived?: true }>;
export type IpaEntry = Readonly<{ UK: readonly IpaReading[]; US: readonly IpaReading[] }>;
/**
 * How the reading was found: the word itself, its lower-case or capitalised spelling, or worked out
 * from a base word by a regular ending ("derived", shown with ≈; see ipa-derive.ts).
 */
export type IpaMatch = Readonly<{ word: string; match: "exact" | "lowercase-fallback" | "capital-fallback" | "derived"; entry: IpaEntry }>;
export type IpaData = { version: string; loaders: Record<string, () => Promise<unknown>> };

import { deriveEntry } from "./ipa-derive.ts";

const WORD = /^[A-Za-z]+(?:[-'’][A-Za-z]+)*$/;
const owns = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

function readings(value: unknown): readonly IpaReading[] {
  if (!Array.isArray(value) || value.length > 128) throw new Error("Invalid IPA readings");
  return Object.freeze(value.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid IPA reading");
    const { ipa, pos } = item as Record<string, unknown>;
    if (typeof ipa !== "string" || !ipa.trim() || ipa.length > 160 || /[<>/\[\]\u0000-\u001f]/.test(ipa)) throw new Error("Invalid IPA text");
    if (pos !== undefined && (typeof pos !== "string" || pos.length > 40)) throw new Error("Invalid IPA annotation");
    return Object.freeze({ ipa, ...(pos ? { pos: pos as string } : {}) });
  }));
}

function validateShard(value: unknown, version: string, letter: string): ReadonlyMap<string, IpaEntry> {
  if (!value || typeof value !== "object") throw new Error("Invalid IPA shard");
  const shard = value as Record<string, unknown>;
  if (shard.schemaVersion !== 1 || shard.version !== version || !shard.words || typeof shard.words !== "object" || Array.isArray(shard.words)) throw new Error("Invalid IPA shard version");
  const result = new Map<string, IpaEntry>();
  for (const [word, raw] of Object.entries(shard.words)) {
    if (!WORD.test(word) || word[0].toLowerCase() !== letter || !raw || typeof raw !== "object") throw new Error("Invalid IPA word");
    const entry = raw as Record<string, unknown>;
    const UK = readings(entry.UK), US = readings(entry.US);
    if (!UK.length && !US.length) throw new Error("Empty IPA entry");
    result.set(word, Object.freeze({ UK, US }));
  }
  return result;
}

/** Exact displayed headword first. Never merge case siblings or guess a lemma. */
export function createIpaLookup(loadData: () => Promise<IpaData>) {
  let data: Promise<IpaData> | undefined;
  const shards = new Map<string, Promise<ReadonlyMap<string, IpaEntry>>>();
  /** Settled shards, so a card can draw a known word on its first frame instead of after a tick. */
  const ready = new Map<string, ReadonlyMap<string, IpaEntry>>();
  function manifest() {
    if (!data) data = loadData().catch((error: unknown) => { data = undefined; throw error; });
    return data;
  }
  function shard(source: IpaData, letter: string): Promise<ReadonlyMap<string, IpaEntry>> {
    let pending = shards.get(letter);
    if (!pending) {
      pending = Promise.resolve().then(() => source.loaders[letter]())
        .then(value => validateShard(value, source.version, letter))
        .then(entries => { ready.set(letter, entries); return entries; })
        .catch((error: unknown) => { shards.delete(letter); throw error; });
      shards.set(letter, pending);
    }
    return pending;
  }
  /** The word itself, or its other ordinary capitalisation (Bath -> bath, french -> French). */
  function spelled(entries: ReadonlyMap<string, IpaEntry>, word: string): IpaMatch | null {
    const exact = entries.get(word);
    if (exact) return { word, match: "exact", entry: exact };
    if (/^[A-Z][a-z]+(?:[-'’][a-z]+)*$/.test(word)) {
      const lower = word.toLowerCase();
      const entry = entries.get(lower);
      if (entry) return { word: lower, match: "lowercase-fallback", entry };
    }
    if (/^[a-z]+(?:[-'’][a-z]+)*$/.test(word)) {
      // Only a capitalised word with no lower-case one: french has no entry, French does.
      const capital = word[0].toUpperCase() + word.slice(1);
      const entry = entries.get(capital);
      if (entry) return { word: capital, match: "capital-fallback", entry };
    }
    return null;
  }
  function pick(entries: ReadonlyMap<string, IpaEntry>, word: string): IpaMatch | null {
    const found = spelled(entries, word);
    if (found && found.entry.UK.length && found.entry.US.length) return found;
    // A regular ending on a base in the same shard: peered from peer, glanced from glance. It also
    // fills the accent a dictionary entry lacks (CMUdict gives peered an American reading only).
    const derived = deriveEntry(word.toLowerCase(), (base) => entries.get(base));
    if (!found) return derived ? { word, match: "derived", entry: derived.entry } : null;
    if (!derived) return found;
    const fill = (accent: "UK" | "US") => (found.entry[accent].length ? found.entry[accent] : derived.entry[accent]);
    return { ...found, entry: Object.freeze({ UK: fill("UK"), US: fill("US") }) };
  }
  const one = async (word: string): Promise<IpaMatch | null> => {
    if (!WORD.test(word) || word.length > 96) return null;
    const source = await manifest();
    const letter = word[0].toLowerCase();
    if (!owns(source.loaders, letter)) return null;
    return pick(await shard(source, letter), word);
  };
  /**
   * `also`: the spelling the reader tapped, tried when `word` (the list's key) has nothing. A key
   * cut too short by the plural rule (perhap for perhaps) still gets the tapped word's reading.
   */
  const lookup = async (word: string, also?: string): Promise<IpaMatch | null> => {
    const first = await one(word);
    if (first && first.match !== "derived") return first;
    const other = also && also !== word ? await one(also) : null;
    if (other && other.match !== "derived") return other;
    return first ?? other;
  };
  /**
   * The answer right now when the word's shard is already in memory: a match, or null for a word
   * the shard does not have. `undefined` means the shard has not arrived yet.
   */
  const nowOne = (word: string): IpaMatch | null | undefined => {
    if (!WORD.test(word) || word.length > 96) return null;
    const entries = ready.get(word[0].toLowerCase());
    return entries ? pick(entries, word) : undefined;
  };
  lookup.now = (word: string, also?: string): IpaMatch | null | undefined => {
    const first = nowOne(word);
    if (first && first.match !== "derived") return first;
    if (!also || also === word) return first;
    const other = nowOne(also);
    if (other && other.match !== "derived") return other;
    if (first === undefined || other === undefined) return undefined;
    return first ?? other;
  };
  /**
   * Load the shards of these first letters (a-z) ahead of a tap, in the order given, a few at a
   * time: one by one took 20 s for a chapter on a phone network (0.8 s each), so an early tap still
   * waited. A failure is dropped here; the card's own lookup tries again and reports it.
   */
  lookup.warm = (letters: Iterable<string>, parallel = 4): void => {
    const queue = [...new Set(letters)].filter(letter => /^[a-z]$/.test(letter));
    void manifest().then(source => {
      const next = async (): Promise<void> => {
        for (let letter = queue.shift(); letter !== undefined; letter = queue.shift()) {
          if (!owns(source.loaders, letter)) continue;
          await (shards.get(letter) ?? shard(source, letter)).catch(() => undefined);
        }
      };
      for (let i = 0; i < Math.max(1, parallel); i += 1) void next();
    }).catch(() => undefined);
  };
  return lookup;
}
