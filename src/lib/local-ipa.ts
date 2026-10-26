export type IpaReading = Readonly<{ ipa: string; pos?: string }>;
export type IpaEntry = Readonly<{ UK: readonly IpaReading[]; US: readonly IpaReading[] }>;
export type IpaMatch = Readonly<{ word: string; match: "exact" | "lowercase-fallback"; entry: IpaEntry }>;
export type IpaData = { version: string; loaders: Record<string, () => Promise<unknown>> };

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
  function pick(entries: ReadonlyMap<string, IpaEntry>, word: string): IpaMatch | null {
    const exact = entries.get(word);
    if (exact) return { word, match: "exact", entry: exact };
    if (/^[A-Z][a-z]+(?:[-'’][a-z]+)*$/.test(word)) {
      const lower = word.toLowerCase();
      const entry = entries.get(lower);
      if (entry) return { word: lower, match: "lowercase-fallback", entry };
    }
    return null;
  }
  const lookup = async (word: string): Promise<IpaMatch | null> => {
    if (!WORD.test(word) || word.length > 96) return null;
    const source = await manifest();
    const letter = word[0].toLowerCase();
    if (!owns(source.loaders, letter)) return null;
    return pick(await shard(source, letter), word);
  };
  /**
   * The answer right now when the word's shard is already in memory: a match, or null for a word
   * the shard does not have. `undefined` means the shard has not arrived yet.
   */
  lookup.now = (word: string): IpaMatch | null | undefined => {
    if (!WORD.test(word) || word.length > 96) return null;
    const entries = ready.get(word[0].toLowerCase());
    return entries ? pick(entries, word) : undefined;
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
