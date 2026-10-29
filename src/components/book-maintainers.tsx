import { Avatar } from "@/components/avatar";
import { useT } from "@/lib/i18n";
import { moreLabel } from "@/lib/contributors-file";
import { useBookMaintainers, useContributors } from "@/lib/contributors";
import { cn } from "@/components/ui";

/**
 * The readers who maintain a book's word list, floating on the cover's top-left corner (the
 * bottom-right holds the add button): up to three faces, folded so the first is whole and the next
 * two tuck behind it, then how many more ("+5", "99+"), on a small frosted pill so it reads on any
 * cover art. On the cover it sits at the same place on every card, whatever the title's length or
 * the tags below it. Only readers whose explanations were accepted into the list count
 * (contributors.json `books`). Nothing is drawn for a book nobody has maintained yet.
 *
 * `bookRef` is `<catalog>:<id>` (src/lib/catalog-id.ts). Decorative and not tappable: the cover's
 * own button opens the book, and the detail sheet names the readers (BookMaintainerList).
 */
export function BookMaintainers({ bookRef, className }: { bookRef: string; className?: string }) {
  const { t } = useT();
  const books = useBookMaintainers();
  const people = useContributors();
  const book = bookRef ? books[bookRef] : undefined;
  if (!book || book.count === 0) return null;
  const faces = book.top
    .map((id) => people.find((person) => person.id === id))
    .filter((person): person is NonNullable<typeof person> => Boolean(person));
  const more = moreLabel(book.count, faces.length);
  const label = t("maintainers.aria", { n: book.count });
  return (
    <span
      className={cn(
        // Top-left: the add button holds the bottom-right, and on a 320px phone a Discover cover is
        // 88px wide, too narrow for both in one row. Here it has the cover's whole width.
        "pointer-events-none absolute top-1.5 left-1.5 z-[2] flex max-w-[calc(100%-0.75rem)] items-center gap-0.5 rounded-full leading-none bg-black/45 py-0.5 pr-1 pl-0.5",
        !more && "pr-0.5",
        className,
      )}
      role="img"
      aria-label={label}
      title={label}
      data-maintainers={book.count}
    >
      <span className="flex shrink-0 items-center">
        {faces.map((person, at) => (
          // The first face is whole and on top; the next two tuck behind it, a sliver of each showing.
          <span key={person.id} className={cn("relative block rounded-full", at > 0 && "-ml-2.5")} style={{ zIndex: faces.length - at }}>
            <Avatar id={person.id} name={person.name} version={person.avatar} size={16} className="ring-[1.5px] ring-white/85" />
          </span>
        ))}
      </span>
      {more ? (
        <span className="shrink-0 text-[0.64rem] leading-none font-semibold tabular-nums text-white" data-maintainers-more>
          {more}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The same readers in the book's detail sheet, with their names: "Maintained by", the faces and
 * nicknames of the three who helped most, and how many more. The file keeps three per book, so a
 * longer list is a count, not more names.
 */
export function BookMaintainerList({ bookRef }: { bookRef: string }) {
  const { t } = useT();
  const books = useBookMaintainers();
  const people = useContributors();
  const book = bookRef ? books[bookRef] : undefined;
  if (!book || book.count === 0) return null;
  const faces = book.top
    .map((id) => people.find((person) => person.id === id))
    .filter((person): person is NonNullable<typeof person> => Boolean(person));
  const more = moreLabel(book.count, faces.length);
  return (
    <section className="grid gap-1.5" aria-label={t("maintainers.title")} data-detail-maintainers={book.count}>
      <h3 className="text-xs font-semibold text-muted">{t("maintainers.title")}</h3>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {faces.map((person) => (
          <li key={person.id} className="flex min-w-0 max-w-full items-center gap-1.5 text-sm">
            <Avatar id={person.id} name={person.name} version={person.avatar} size={22} />
            <span className="truncate">{person.name || t("card.creditAnon")}</span>
          </li>
        ))}
        {more ? (
          <li className="text-sm font-semibold tabular-nums text-muted" data-maintainers-more>
            {more}
          </li>
        ) : null}
      </ul>
    </section>
  );
}
