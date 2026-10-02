/**
 * Narrow screens keep a fixed panel so the reading text never moves when it opens.
 * Phones (under `md`) use a bottom sheet. Tablets (`md` up to `lg`) keep a right-hand column
 * and the page reserves READER_GUTTER for it.
 * Wide screens (`lg`, 1024px and up) do not reserve that column. The card floats over the
 * centered text instead (see FloatingAside). The gutter class drops away at `lg`.
 */
export const SIDE_PANEL =
  "md:inset-x-auto md:top-[4.5rem] md:right-4 md:bottom-5 md:max-h-none md:w-72 md:rounded-2xl md:border md:pt-5 lg:right-5 lg:w-[21rem]";

/**
 * Room kept on the right for the tablet column. Wide screens use the same horizontal padding
 * on both sides, so the reading column stays centered at the text-width setting.
 */
export const READER_GUTTER = "md:pr-[20rem] lg:pr-8";
