import type { ContentCategory } from "@/lib/content-category";

export type AdminBookKind = "private" | "public";

/** Public books publish their EPUB and list together, never through the private-list catalog. */
export async function publishAdminBook(
  input: {
    id: string;
    kind: AdminBookKind;
    category: ContentCategory;
    isbn: string;
    series: string;
    seriesNumber: string;
    glossaryText: string;
    form: FormData;
  },
  actions: {
    raw: (path: string, body: string) => Promise<unknown>;
    form: (path: string, body: FormData) => Promise<unknown>;
    wordsSaved: () => void;
  },
): Promise<void> {
  const params = new URLSearchParams({
    id: input.id,
    isbn: input.isbn.trim(),
    category: input.category,
    series: input.series.trim(),
    seriesNumber: input.series.trim() ? input.seriesNumber.trim() : "",
  });
  if (input.kind === "private") {
    await actions.raw(`/api/admin/word-lists?${params}`, input.glossaryText);
    actions.wordsSaved();
  }
  params.set("kind", input.kind);
  await actions.form(`/api/admin/books?${params}`, input.form);
}
