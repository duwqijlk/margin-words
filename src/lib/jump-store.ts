import { create } from "zustand";
import { sentenceAnchor, type TextAnchor } from "@/lib/position";
import { navigate } from "@/lib/router";
import type { QuoteRecord } from "@/lib/quote-model";
import type { Book, WordSource } from "@/lib/vocab-model";

/** "Open this book at that place" asked from the wordbook. The reader takes it once when the book is ready. */
export type JumpRequest = {
  bookId: string;
  at: TextAnchor;
  surface?: string;
  /** a kept quote: its own words light up once the reader is there, not the whole paragraph */
  text?: string;
};

type JumpState = {
  request: JumpRequest | null;
  ask: (request: JumpRequest) => void;
  take: (bookId: string) => JumpRequest | null;
};

export const useJump = create<JumpState>()((set, get) => ({
  request: null,
  ask: (request) => set({ request }),
  take: (bookId) => {
    const request = get().request;
    if (!request || request.bookId !== bookId) return null;
    set({ request: null });
    return request;
  },
}));

/** Open the book where a word was met. The reader finds the place in this device's own copy of the text. */
export function jumpToSource(source: WordSource, book: Book): void {
  const at = source.at ?? (source.sentence ? sentenceAnchor(source.sentence, source.chapter) : undefined);
  if (at) useJump.getState().ask({ bookId: book.id, at, surface: source.surface });
  navigate({ kind: "read", bookId: book.id });
}

/** Open the book at a kept quote. The reader finds it in this device's copy and lights it up. */
export function jumpToQuote(quote: QuoteRecord, bookId: string): void {
  useJump.getState().ask({ bookId, at: quote.at, text: quote.text.replace(/…$/, "") });
  navigate({ kind: "read", bookId });
}
