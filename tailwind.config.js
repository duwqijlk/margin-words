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
        muted: withAlpha("muted"),
        line: withAlpha("line"),
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
      borderRadius: {
        md: "0.625rem",
        lg: "0.875rem",
        xl: "1.25rem",
      },
      // v4 renamed these (`shadow-xs` became its `sm`, and `2xs` is new). The class names are
      // used in 81 places, so the keys are defined here rather than renamed in the components.
      boxShadow: {
        "2xs": "0 1px 2px rgb(0 0 0 / 0.05)",
        xs: "0 1px 2px rgb(0 0 0 / 0.05)",
        cover: "0 2px 5px rgb(0 0 0 / 0.08), 0 8px 20px -4px rgb(0 0 0 / 0.16)",
        pop: "0 10px 40px -8px rgb(0 0 0 / 0.28), 0 2px 6px rgb(0 0 0 / 0.1)",
      },
    },
  },
  plugins: [],
};
