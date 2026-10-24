/**
 * Phones (under `md`) use a bottom sheet. Tablets and wide screens (`md`, 768px and up) float the
 * card over the text next to the tapped word (see FloatingAside), so the reading text never moves.
 * These classes are only the card's resting shape before the placement script sets its box.
 */
export const SIDE_PANEL =
  "md:inset-x-auto md:top-[4.5rem] md:right-4 md:bottom-5 md:max-h-none md:w-72 md:rounded-2xl md:border md:pt-5 lg:right-5 lg:w-[21rem]";

/**
 * The same horizontal padding on both sides from `md` up, so the reading column stays centered
 * at the text-width setting. Tablets no longer keep a column empty on the right for the card.
 */
export const READER_GUTTER = "md:pr-8";
