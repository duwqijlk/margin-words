import { useEffect, useMemo, useState } from "react";
import { useT, type Key } from "@/lib/i18n";
import { BUNDLED_CATALOG_URL } from "@/lib/packs";
import { WORD_LIST_CATALOG_URL } from "@/lib/word-list-catalog";
import { BLURB_ID, BLURB_MAX, blurbProblems, type BlurbKind } from "@/lib/book-blurb-file";
import { forgetBlurb } from "@/lib/book-blurbs";
import { btn, cn, field } from "@/components/ui";

type Book = { kind: BlurbKind; id: string; title: string; author: string };

const PROBLEM_KEYS: Record<string, Key> = {
  "zh:no-chinese": "admin.blurb.err.zhNoChinese",
  "en:has-chinese": "admin.blurb.err.enChinese",
  "zh:too-long": "admin.blurb.err.tooLong",
  "en:too-long": "admin.blurb.err.tooLong",
  "zh:markup": "admin.blurb.err.markup",
  "en:markup": "admin.blurb.err.markup",
};

function booksOf(kind: BlurbKind, rows: unknown): Book[] {
  if (!Array.isArray(rows)) return [];
  const text = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
  return rows.flatMap((item) => {
    const row = (item ?? {}) as { id?: unknown; title?: unknown; author?: unknown };
    const id = text(row.id);
    return BLURB_ID.test(id) ? [{ kind, id, title: text(row.title) || id, author: text(row.author) }] : [];
  });
}

/** Admin editor for the story summary each book shows in the Discover sheet (in R2, next to its word list). */
export function BlurbAdmin() {
  const { t } = useT();
  const [books, setBooks] = useState<Book[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [book, setBook] = useState<Book | null>(null);
  const [zh, setZh] = useState("");
  const [en, setEn] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void Promise.all([
      fetch(WORD_LIST_CATALOG_URL, { cache: "no-cache" }).then((response) => (response.ok ? response.json() : { lists: [] })),
      fetch(BUNDLED_CATALOG_URL, { cache: "no-cache" }).then((response) => (response.ok ? response.json() : { packs: [] })),
    ])
      .then(([lists, packs]) => {
        if (alive)
          setBooks([
            ...booksOf("lists", (lists as { lists?: unknown }).lists),
            ...booksOf("public", (packs as { packs?: unknown }).packs),
          ]);
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!books || !q) return [];
    return books.filter((item) => `${item.title} ${item.author} ${item.id}`.toLowerCase().includes(q)).slice(0, 12);
  }, [books, query]);

  async function open(next: Book) {
    setBook(next);
    setZh("");
    setEn("");
    setNote("");
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/blurb?kind=${next.kind}&id=${encodeURIComponent(next.id)}`, {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("load");
      const value = (await response.json()) as { zh?: string; en?: string };
      setZh(value.zh ?? "");
      setEn(value.en ?? "");
    } catch {
      setError(t("admin.blurb.err.load"));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!book || busy) return;
    const problems = blurbProblems({ zh, en });
    if (problems.length) {
      setError(problems.map((code) => t(PROBLEM_KEYS[code] ?? "admin.blurb.err.save")).join(" "));
      return;
    }
    setBusy(true);
    setNote("");
    setError("");
    try {
      const response = await fetch(`/api/admin/blurb?kind=${book.kind}&id=${encodeURIComponent(book.id)}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ zh, en }),
      });
      if (!response.ok) throw new Error("save");
      forgetBlurb(book.kind, book.id);
      setNote(t("admin.blurb.saved"));
    } catch {
      setError(t("admin.blurb.err.save"));
    } finally {
      setBusy(false);
    }
  }

  const counter = (value: string) => (
    <span className={cn("text-xs tabular-nums", value.length > BLURB_MAX ? "text-warn" : "text-muted")}>
      {value.length}/{BLURB_MAX}
    </span>
  );

  return (
    <section className="grid gap-4" data-blurb-admin>
      <p className="text-sm leading-6 text-muted">{t("admin.blurb.hint")}</p>
      {loadError ? <p className="text-sm text-warn">{t("admin.blurb.err.catalog")}</p> : null}
      <label className="grid gap-1.5 text-sm font-semibold">
        {t("admin.blurb.search")}
        <input className={field} value={query} onChange={(event) => setQuery(event.target.value)} data-blurb-search />
      </label>
      {matches.length ? (
        <ul className="grid gap-1" data-blurb-matches>
          {matches.map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              <button
                type="button"
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent-soft/50",
                  book?.kind === item.kind && book.id === item.id && "bg-accent-soft",
                )}
                onClick={() => void open(item)}
                data-blurb-book={`${item.kind}:${item.id}`}
              >
                <span className="font-semibold" lang="en">{item.title}</span>
                <span className="text-muted" lang="en"> · {item.author} · {item.id}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {book ? (
        <div className="grid gap-3 rounded-2xl border border-line bg-card p-4" data-blurb-editor={`${book.kind}:${book.id}`}>
          <h3 className="font-semibold" lang="en">
            {book.title} <span className="text-sm font-normal text-muted">({book.kind === "public" ? "public-books" : "word-lists"}/{book.id})</span>
          </h3>
          {loading ? <p className="text-sm text-muted">{t("dashboard.loading")}</p> : null}
          <label className="grid gap-1.5 text-sm font-semibold">
            <span className="flex items-center justify-between">{t("admin.blurb.zh")}{counter(zh)}</span>
            <textarea className={cn(field, "min-h-28 py-2")} value={zh} onChange={(event) => setZh(event.target.value)} lang="zh-CN" data-blurb-zh />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            <span className="flex items-center justify-between">{t("admin.blurb.en")}{counter(en)}</span>
            <textarea className={cn(field, "min-h-28 py-2")} value={en} onChange={(event) => setEn(event.target.value)} lang="en" data-blurb-en />
          </label>
          {error ? <p className="text-sm text-warn" role="alert">{error}</p> : null}
          {note ? <p className="text-sm text-accent" role="status">{note}</p> : null}
          <button type="button" className={cn(btn.primary, "justify-self-start")} disabled={busy || loading} onClick={() => void save()} data-blurb-save>
            {t("admin.blurb.save")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
