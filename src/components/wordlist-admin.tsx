import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { accountPostRaw } from "@/lib/sync-engine";
import { WORD_LIST_CATALOG_URL } from "@/lib/word-list-catalog";
import { btn, cn, field } from "@/components/ui";

type CatalogList = { id: string; title: string; author?: string; words?: number };

type Preview =
  | { ok: true; words: number; paragraphs: number; sentences: number; phrases: number; bytes: number }
  | { ok: false; problem: string };

function previewOf(text: string): Preview | null {
  if (!text.trim()) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, problem: "admin.lists.badGlossary" };
  }
  const glossary = (data as { glossary?: unknown })?.glossary;
  if (!glossary || typeof glossary !== "object" || Array.isArray(glossary) || Object.keys(glossary).length === 0) {
    return { ok: false, problem: "admin.lists.badGlossary" };
  }
  const record = data as {
    count?: unknown;
    glossary: Record<string, unknown>;
    paragraphs?: unknown;
    sentences?: unknown;
    phrases?: unknown;
  };
  return {
    ok: true,
    words: Number(record.count) || Object.keys(record.glossary).length,
    paragraphs: Array.isArray(record.paragraphs) ? record.paragraphs.length : 0,
    sentences: Array.isArray(record.sentences) ? record.sentences.length : 0,
    phrases: record.phrases && typeof record.phrases === "object" ? Object.keys(record.phrases).length : 0,
    bytes: new TextEncoder().encode(text).length,
  };
}

const ERROR_KEYS: Record<string, string> = {
  "unknown-id": "admin.lists.unknownId",
  "bad-glossary": "admin.lists.badGlossary",
  "bad-json": "admin.lists.badGlossary",
  "too-large": "admin.lists.tooLarge",
  "no-books-bucket": "admin.error",
  "no-catalog": "admin.error",
};

/** The word-list tab: pick a book, drop the new glossary JSON, publish. */
export function WordListAdmin() {
  const { t } = useT();
  const [lists, setLists] = useState<CatalogList[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [id, setId] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch(WORD_LIST_CATALOG_URL, { cache: "no-cache" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((catalog: { lists?: CatalogList[] }) => {
        if (alive) setLists(catalog.lists ?? []);
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const preview = useMemo(() => previewOf(text), [text]);

  async function publish() {
    if (!id || !preview?.ok || busy) return;
    setBusy(true);
    setNote("");
    setError("");
    try {
      await accountPostRaw(`/api/admin/word-lists?id=${encodeURIComponent(id)}`, text);
      setNote(t("admin.lists.published"));
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(t((ERROR_KEYS[code] ?? "admin.lists.error") as Parameters<typeof t>[0]));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4" data-admin-lists>
      <p className="text-sm text-muted">{t("admin.lists.hint")}</p>
      {loadError ? (
        <p role="alert">{t("admin.lists.error")}</p>
      ) : lists === null ? (
        <p>{t("dashboard.loading")}</p>
      ) : (
        <>
          <label className="grid gap-1 text-sm font-medium" htmlFor="admin-list-book">
            {t("admin.lists.pick")}
            <select id="admin-list-book" className={field} value={id} onChange={(event) => setId(event.target.value)}>
              <option value="">—</option>
              {lists.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                  {item.author ? ` · ${item.author}` : ""} ({item.id})
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium" htmlFor="admin-list-file">
            {t("admin.lists.file")}
            <input
              id="admin-list-file"
              className={cn(field, "py-2")}
              type="file"
              accept=".json,application/json"
              data-admin-list-file
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setNote("");
                setError("");
                void file.text().then(setText);
              }}
            />
          </label>
          {preview ? (
            preview.ok ? (
              <p className="text-sm" data-admin-list-preview>
                {t("admin.lists.preview", {
                  words: preview.words,
                  paragraphs: preview.paragraphs,
                  sentences: preview.sentences,
                  phrases: preview.phrases,
                })}{" "}
                · {(preview.bytes / 1024).toFixed(0)} KB
              </p>
            ) : (
              <p className="text-sm text-warn" role="alert">
                {t(preview.problem as Parameters<typeof t>[0])}
              </p>
            )
          ) : null}
          {note ? <p className="text-sm text-accent">{note}</p> : null}
          {error ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className={cn(btn.primary, "justify-start")}
            disabled={!id || !preview?.ok || busy}
            data-admin-list-publish
            onClick={() => void publish()}
          >
            {busy ? t("account.working") : t("admin.lists.publish")}
          </button>
        </>
      )}
    </div>
  );
}
