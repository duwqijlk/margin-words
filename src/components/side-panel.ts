/**
 * Where the side panel (word card, paragraph help) sits at tablet and desktop widths: fixed on the right,
 * below the header. The reader keeps this much room free on the right at all times (READER_GUTTER), so the
 * panel opens, changes and closes without anything on the page moving. Phones use a bottom sheet instead.
 */
export const SIDE_PANEL =
  "md:inset-x-auto md:top-[4.5rem] md:right-4 md:bottom-5 md:max-h-none md:w-72 md:rounded-2xl md:border md:pt-5 lg:right-5 lg:w-[21rem]";

/** Room kept free on the right of the page for the side panel. Same widths as SIDE_PANEL, plus a gap. */
export const READER_GUTTER = "md:pr-[20rem] lg:pr-[23.5rem]";
