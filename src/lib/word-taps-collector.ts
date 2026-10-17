/**
 * Lightweight client-side aggregator for word taps during reading.
 * Collects tapped words in memory, filters out noise/stop-words,
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

type BufferedTap = {
  bookId: string;
  word: string;
  count: number;
  inGlossary: boolean;
};

const buffer = new Map<string, BufferedTap>();
let timer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

function cleanWord(surface: string): string | null {
  const norm = surface.trim().toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
  if (norm.length < 2 || norm.length > 40) return null;
  if (!/^[a-z]+(?:-[a-z]+)?$/.test(norm)) return null;
  if (STOP_WORDS.has(norm)) return null;
  return norm;
}

/** Record a word tap in memory. Completely non-blocking and silent. */
export function recordWordTap(bookId: string, surface: string, inGlossary: boolean): void {
  const word = cleanWord(surface);
  if (!word || !bookId) return;

  const key = `${bookId}:${word}`;
  const existing = buffer.get(key);
  if (existing) {
    existing.count += 1;
    if (inGlossary) existing.inGlossary = true;
  } else {
    if (buffer.size >= 100) return; // Prevent unbound memory growth
    buffer.set(key, { bookId, word, count: 1, inGlossary });
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

/** Flush buffered taps to the analytics endpoint in batches. */
export async function flushWordTaps(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (buffer.size === 0) return;

  // Group by bookId
  const groups = new Map<string, Array<{ word: string; count: number; inGlossary: boolean }>>();
  for (const item of buffer.values()) {
    const list = groups.get(item.bookId) ?? [];
    list.push({ word: item.word, count: item.count, inGlossary: item.inGlossary });
    groups.set(item.bookId, list);
  }
  buffer.clear();

  for (const [bookId, taps] of groups) {
    // Send in chunks of 50
    for (let i = 0; i < taps.length; i += 50) {
      const chunk = taps.slice(i, i + 50);
      const payload = JSON.stringify({ bookId, taps: chunk });
      try {
        if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
          const blob = new Blob([payload], { type: "application/json" });
          const sent = navigator.sendBeacon("/api/analytics/word-taps", blob);
          if (sent) continue;
        }
        await fetch("/api/analytics/word-taps", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
          keepalive: true,
        });
      } catch {
        // Silently swallow network errors during flush
      }
    }
  }
}

// Auto-flush on page hide / tab close
if (typeof window !== "undefined" && typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushWordTaps();
    }
  });
  window.addEventListener("pagehide", () => {
    void flushWordTaps();
  });
}
