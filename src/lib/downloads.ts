/**
 * Pack downloads run outside any screen, so leaving the "Get books" screen does not stop one.
 * The store only keeps what the screens need to draw: progress and a friendly error.
 */
import { create } from "zustand";
import { tr } from "@/lib/i18n";
import { downloadPack, type CatalogPack, type DownloadProgress } from "@/lib/packs";
import { useVocab } from "@/lib/vocab-store";
import { clearPackRemoved } from "@/lib/removed-packs";

export type DownloadItem = { stage: DownloadProgress["stage"]; fraction: number; error: string };

type DownloadState = {
  items: Record<string, DownloadItem>;
  /** goes up every time a pack finished, so screens know to read the list of packs again */
  finished: number;
  start: (catalogUrl: string, pack: CatalogPack) => Promise<void>;
  dismiss: (packId: string) => void;
};

export const useDownloads = create<DownloadState>()((set, get) => ({
  items: {},
  finished: 0,
  start: async (catalogUrl, pack) => {
    const known = get().items[pack.id];
    if (known && !known.error) return;
    set((state) => ({
      items: { ...state.items, [pack.id]: { stage: "book", fraction: 0, error: "" } },
    }));
    try {
      const result = await downloadPack(catalogUrl, pack, (progress) =>
        set((state) => ({
          items: { ...state.items, [pack.id]: { ...progress, error: "" } },
        })),
      );
      clearPackRemoved(pack.id);
      const { books, addBook } = useVocab.getState();
      // A book that is already on the shelf (an update) keeps its place, its name and its cover colour.
      if (!books.some((book) => book.id === result.bookId)) {
        addBook(result.title, result.author, "epub", result.bookId);
      }
      useVocab.getState().setBookDetails([
        {
          id: result.bookId,
          lexile: pack.lexile,
          isbn: pack.isbn,
          series: pack.series,
          seriesNumber: pack.seriesNumber,
        },
      ]);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("cibian-progress", { detail: { bookId: result.bookId } }),
        );
      }
      set((state) => {
        const items = { ...state.items };
        delete items[pack.id];
        return { items, finished: state.finished + 1 };
      });
    } catch (reason) {
      const message =
        reason instanceof Error && reason.message ? reason.message : tr("err.bookAddFailed");
      set((state) => ({
        items: { ...state.items, [pack.id]: { stage: "book", fraction: 0, error: message } },
      }));
    }
  },
  dismiss: (packId) =>
    set((state) => {
      const items = { ...state.items };
      delete items[packId];
      return { items };
    }),
}));
