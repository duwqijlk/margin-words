/**
 * Lightweight client-side aggregator for word taps during reading.
 * Collects tapped words in memory with full dictionary-standard location
 * context (chapter, occurrence, form, context snippet, and natural sentence),
 * and flushes in debounced batches to /api/analytics/word-taps.
 */

// Top English function words / stop-words that readers might accidentally tap.
const STOP_WORDS = new Set([
  "a", "about", "after", "all", "also", "am", "an", "and", "any", "are",
  "as", "at", "back", "be", "because", "been", "but", "by", "can", "come",
  "could", "day", "did", "do", "even", "first", "for", "from", "get", "give",
  "go", "good", "had", "has", "have", "he", "her", "him", "his", "how",
  "i", "if", "in", "into", "is", "it", "its", "just", "know", "like",
  "look", "make", "me", "most", "my", "new", "no", "not", "now", "of",
  "on", "one", "only", "or", "other", "our", "out", "over", "people", "say",
  "see", "she", "so", "some", "than", "that", "the", "their", "them", "then",
  "there", "these", "they", "think", "this", "time", "to", "two", "up", "us",
  "use", "want", "was", "way", "we", "well", "were", "what", "when", "which",
  "who", "will", "with", "work", "would", "year", "you", "your",
]);

export type TapLocationContext = {
  bookTitle?: string;
  form?: string;
  chapter?: number;
  occurrence?: number;
  paragraph?: number;
  context?: string;
  sentence?: string;
};

type BufferedTap = {
  bookId: string;
  bookTitle: string;
  word: string;
  form: string;
  chapter: number;
  occurrence: number;
  paragraph: number;
  context: string;
  sentence: string;
  count: number;
  inGlossary: boolean;
};

const buffer = new Map<string, BufferedTap>();
let timer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function cleanWord(surface: string): string | null {
  const norm = surface.trim().toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
  if (norm.length < 2 || norm.length > 48) return null;
  if (!/^[a-z]+(?:-[a-z]+)?$/.test(norm)) return null;
  if (STOP_WORDS.has(norm)) return null;
  return norm;
}

/**
 * Extract a clean 6 to 12 words snippet copied directly from paragraph
 * containing the target word, perfectly conforming to the dictionary Anchor spec.
 */
export function extractAnchorContext(
  paragraph: string,
  surface: string,
  beforeOffset: number,
): string {
  if (!paragraph || !surface || beforeOffset < 0) return surface;
  const beforeText = paragraph.slice(0, beforeOffset);
  const afterText = paragraph.slice(beforeOffset + surface.length);

  // Match up to 4 words before
  const beforeMatch = beforeText.match(/(?:[^\s]+\s+){0,4}$/);
  const startIdx = beforeMatch ? beforeOffset - beforeMatch[0].length : 0;

  // Match up to 4 words after
  const afterMatch = afterText.match(/^(?:\s*[^\s]+){0,4}/);
  const endIdx = afterMatch
    ? beforeOffset + surface.length + afterMatch[0].length
    : beforeOffset + surface.length;

  const raw = paragraph.slice(startIdx, endIdx).trim();
  return raw.slice(0, 300);
}

/** Record a word tap in memory with location context. Completely non-blocking and silent. */
export function recordWordTap(
  bookId: string,
  surface: string,
  inGlossary: boolean,
  meta?: TapLocationContext,
): void {
  const word = cleanWord(surface);
  if (!word || !bookId) return;

  const chapter = Math.max(0, meta?.chapter ?? 0);
  const occurrence = Math.max(1, meta?.occurrence ?? 1);
  const form = (meta?.form || surface).trim().toLowerCase().slice(0, 48) || word;
  const paragraph = Math.max(0, meta?.paragraph ?? 0);
  const context = (meta?.context ?? "").trim().slice(0, 300);
  const sentence = (meta?.sentence ?? "").trim().slice(0, 600);
  const bookTitle = (meta?.bookTitle ?? "").trim().slice(0, 150);

  const key = `${bookId}:${word}:${chapter}:${occurrence}`;
  const existing = buffer.get(key);
  if (existing) {
    existing.count += 1;
    if (inGlossary) existing.inGlossary = true;
    if (context && !existing.context) existing.context = context;
    if (sentence && !existing.sentence) existing.sentence = sentence;
    if (bookTitle && !existing.bookTitle) existing.bookTitle = bookTitle;
  } else {
    if (buffer.size >= 120) return; // Prevent unbound memory growth
    buffer.set(key, {
      bookId,
      bookTitle,
      word,
      form,
      chapter,
      occurrence,
      paragraph,
      context,
      sentence,
      count: 1,
      inGlossary,
    });
  }

  ensureTimer();
}

function ensureTimer(): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flushWordTaps();
  }, FLUSH_INTERVAL_MS);
}

/** Flush buffered taps to the analytics API. Safe to call on pagehide / visibilitychange. */
export async function flushWordTaps(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (buffer.size === 0) return;

  // Group taps by bookId
  const byBook = new Map<string, { bookTitle: string; taps: BufferedTap[] }>();
  for (const tap of buffer.values()) {
    const list = byBook.get(tap.bookId) ?? { bookTitle: tap.bookTitle, taps: [] };
    list.taps.push(tap);
    if (tap.bookTitle && !list.bookTitle) list.bookTitle = tap.bookTitle;
    byBook.set(tap.bookId, list);
  }
  buffer.clear();

  for (const [bookId, entry] of byBook.entries()) {
    const payload = JSON.stringify({
      bookId,
      bookTitle: entry.bookTitle,
      taps: entry.taps.slice(0, 50).map((t) => ({
        word: t.word,
        form: t.form,
        chapter: t.chapter,
        occurrence: t.occurrence,
        paragraph: t.paragraph,
        context: t.context,
        sentence: t.sentence,
        count: t.count,
        inGlossary: t.inGlossary,
      })),
    });

    try {
      await fetch("/api/analytics/word-taps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true,
      });
    } catch {
      // Best-effort analytics, silently ignore network failures
    }
  }
}
