import { Compass } from "lucide-react";
import { useEffect, useState } from "react";
import { BookCover } from "@/components/book-cover";
import { btn, cn } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { BUNDLED_CATALOG_URL, loadCatalog, resolveAgainst, type CatalogPack } from "@/lib/packs";
import { navigate } from "@/lib/router";

/** The classic that the empty shelf suggests as a first book. It is an ordinary book once it is added. */
const SUGGESTED_ID = "alice";

/**
 * A suggestion on the empty shelf: a good first book. The button goes to Discover, because
 * Discover is the only place that adds books (and adding needs a signed-in account). Hidden when
 * the catalog cannot be read (offline, first visit): the Discover button above it is still there.
 */
export function FirstBookSuggestion() {
  const { t } = useT();
  const [pack, setPack] = useState<CatalogPack | null>(null);

  useEffect(() => {
    let alive = true;
    void loadCatalog(BUNDLED_CATALOG_URL)
      .then(({ catalog }) => {
        if (alive) setPack(catalog.packs.find((entry) => entry.id === SUGGESTED_ID) ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!pack) return null;
  const cover = pack.cover?.url ? resolveAgainst(BUNDLED_CATALOG_URL, pack.cover.url) : undefined;

  return (
    <section
      className="grid w-full max-w-xl grid-cols-[5rem_1fr] items-center gap-4 rounded-2xl bg-paper p-3.5 text-left sm:grid-cols-[6rem_1fr] sm:p-4"
      aria-labelledby="first-book-title"
      data-first-book
    >
      <div className="w-20 sm:w-24">
        <BookCover title={pack.title} author={pack.author} cover={cover} />
      </div>
      <div className="grid gap-1.5">
        <p className="text-xs font-semibold tracking-wide text-accent uppercase" id="first-book-title">
          {t("shelf.suggestTitle")}
        </p>
        <p className="font-display text-lg leading-snug font-semibold">{pack.title}</p>
        <p className="text-sm text-muted">{t("shelf.suggestBody")}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={cn(btn.quiet, "px-4")}
            onClick={() => navigate({ kind: "discover" })}
            data-first-book-add
          >
            <Compass className="size-4" aria-hidden />
            {t("shelf.suggestGo")}
          </button>
        </div>
      </div>
    </section>
  );
}
