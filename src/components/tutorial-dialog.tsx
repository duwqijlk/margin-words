import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { compareSeriesPlace } from "@/lib/discover-rails";
import { resolveAgainst } from "@/lib/packs";
import { navigate } from "@/lib/router";
import { STARTER_SERIES, useDiscoverIntent, useTutorial } from "@/lib/tutorial";
import { loadWordListCatalog, WORD_LIST_CATALOG_URL } from "@/lib/word-list-catalog";
import { BookCover } from "@/components/book-cover";
import { ArtDiscover, ArtEpub, ArtTapWord, ArtWordList } from "@/components/tutorial-art";
import { StepDialog } from "@/components/step-dialog";
import { cn } from "@/components/ui";

type Starter = { id: string; title: string; author: string; cover: string };

/** The first books of the starter series, with their covers, from the word-list catalog. */
function useStarterBooks(): Starter[] {
  const [books, setBooks] = useState<Starter[]>([]);
  useEffect(() => {
    let alive = true;
    void loadWordListCatalog()
      .then((packs) => {
        if (!alive) return;
        const series = packs
          .filter((pack) => pack.series === STARTER_SERIES && pack.category !== "speech")
          .sort(compareSeriesPlace)
          .slice(0, 3)
          .map((pack) => ({
            id: pack.id,
            title: pack.title,
            author: pack.author,
            cover: pack.cover?.url ? resolveAgainst(WORD_LIST_CATALOG_URL, pack.cover.url) : "",
          }));
        setBooks(series);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return books;
}

/**
 * How this reader works, in five animated steps: every book has its own word list, so a book is
 * found in Discover, paired with the reader's own EPUB, and read by tapping words. The last step
 * recommends the Magic Tree House series and its button opens it in Discover. Shown once on an
 * empty shelf (src/lib/tutorial.ts) and from Settings; the shelf itself stays one line of text.
 * The frame (step-dialog.tsx) is shared with the feedback tip.
 */
export default function TutorialDialog() {
  const { t } = useT();
  const open = useTutorial((state) => state.open);
  const hide = useTutorial((state) => state.hide);
  const starters = useStarterBooks();
  const seeSeries = () => {
    hide();
    useDiscoverIntent.getState().openSeries(STARTER_SERIES);
    navigate({ kind: "discover", category: "novel" });
  };
  const covers = (
    <div className="tut-art flex h-full w-full items-end justify-center gap-0 px-6 pb-3" data-tutorial-starters>
      {(starters.length ? starters : [null, null, null]).map((book, index) => (
        <div
          key={book?.id ?? index}
          className={cn("w-[28%] shrink-0", index === 1 ? "z-[1] -mx-3 mb-3 w-[32%]" : "opacity-95", index === 0 && "tut-fan1", index === 2 && "tut-fan3")}
          style={index === 1 ? undefined : { transform: index === 0 ? "rotate(-10deg) translateX(-6px)" : "rotate(10deg) translateX(6px)" }}
        >
          <div>
            {book ? (
              <BookCover title={book.title} author={book.author} cover={book.cover || undefined} />
            ) : (
              <div className="aspect-cover w-full rounded-md bg-line" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <StepDialog
      name="tutorial"
      title={t("tutorial.title")}
      open={open}
      onClose={hide}
      finish={{ label: t("tutorial.s5Go"), onClick: seeSeries, data: "data-tutorial-series" }}
      steps={[
        { heading: t("tutorial.s1Title"), body: t("tutorial.s1Body"), art: <ArtWordList label={t("tutorial.s1Title")} tag={t("tutorial.tagList")} /> },
        { heading: t("tutorial.s2Title"), body: t("tutorial.s2Body"), art: <ArtDiscover label={t("tutorial.s2Title")} tag={t("tutorial.tagAdded")} /> },
        { heading: t("tutorial.s3Title"), body: t("tutorial.s3Body"), art: <ArtEpub label={t("tutorial.s3Title")} tag={t("tutorial.tagMatched")} /> },
        { heading: t("tutorial.s4Title"), body: t("tutorial.s4Body"), art: <ArtTapWord label={t("tutorial.s4Title")} /> },
        { heading: t("tutorial.s5Title"), body: t("tutorial.s5Body"), art: covers },
      ]}
    />
  );
}
