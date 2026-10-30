/**
 * Tailwind 3, not 4.
 *
 * v4 cannot reach an Android e-ink reader: it puts every rule inside `@layer` (Chrome 99) and
 * writes colours as `oklch()` / `color-mix()` (Chrome 111). That device runs a 2018 WebView, so
 * the layout came out as plain buttons in a column. v3 writes plain CSS with physical
 * properties, no cascade layers and no modern colour functions.
 *
 * The colour tokens are the CSS variables in src/styles.css (one set per reading theme). Each
 * one has an `-rgb` twin holding the same colour as channels: Tailwind 3 can only apply an
 * opacity modifier to `rgb(... / <alpha-value>)`, and the app uses `bg-paper/90` and friends in
 * 242 places.
 */
const withAlpha = (name) => `rgb(var(--${name}-rgb) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: withAlpha("paper"),
        card: withAlpha("card"),
        ink: withAlpha("ink"),
        // ink-2: secondary text. faint (ink-3): meta only. line (rule): hairlines. edge: control borders.
        muted: withAlpha("muted"),
        faint: withAlpha("faint"),
        line: withAlpha("line"),
        edge: withAlpha("edge"),
        // sheet: the layer laid on the page (continue card, notices, hover ground). card: the word card.
        sheet: withAlpha("sheet"),
        // Depth (design system v44): raised = surface-2 (hero cards), float = surface-3 (word card,
        // book detail, panels, menus). float-edge is a floating layer's hairline (a light edge at night).
        raised: withAlpha("surface-2"),
        float: withAlpha("surface-3"),
        "float-edge": "var(--edge-3)",
        accent: withAlpha("accent"),
        "accent-ink": withAlpha("accent-ink"),
        "accent-soft": withAlpha("accent-soft"),
        warn: withAlpha("warn"),
        "warn-soft": withAlpha("warn-soft"),
        mark: withAlpha("mark"),
      },
      // The stacks themselves live in src/styles.css, because the reader's own rules fall back
      // to `var(--font-display)` and a Tailwind theme key does not emit a CSS variable in v3.
      fontFamily: {
        display: "var(--font-display)",
        sans: "var(--font-sans)",
      },
      // Radii (design system "Keep reading"): 2px marks on text, 10px controls, chips and notices,
      // 16px cards, dialogs and popovers, 6px book covers. `card` and `sheet` are the word card's own
      // (floating, phone sheet). No pills: rounded-full is for dots, switches and avatars only.
      borderRadius: {
        sm: "2px",
        DEFAULT: "10px",
        md: "10px",
        lg: "10px",
        xl: "10px",
        "2xl": "16px",
        "3xl": "16px",
        cover: "6px",
        card: "1.25rem",
        sheet: "1.5rem",
      },
      // v4 renamed these (`shadow-xs` became its `sm`, and `2xs` is new). The class names are
      // used in 81 places, so the keys are defined here rather than renamed in the components.
      boxShadow: {
        "2xs": "0 1px 2px rgb(0 0 0 / 0.05)",
        xs: "0 1px 2px rgb(0 0 0 / 0.05)",
        cover: "0 1px 2px rgb(0 0 0 / 0.14), 0 6px 14px -6px rgb(0 0 0 / 0.2)",
        // Depth (design system v44), per theme in styles.css. lift and pop: the floating level (elev-3:
        // dialogs, popovers, phone panels, the word card). hero: the raised level (elev-2: continue
        // reading, the newest book, the review launcher). At night both are light edges; on e-ink, lines.
        lift: "var(--elev-3)",
        hero: "var(--elev-2)",
        pop: "var(--elev-3)",
      },
    },
  },
  plugins: [],
};
