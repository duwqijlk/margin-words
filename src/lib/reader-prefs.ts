import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export type Theme = "light" | "sepia" | "dark";
export type FontKey = "literata" | "lora" | "sans";
export type WidthKey = "narrow" | "medium" | "wide";

export const FONT_STACKS: Record<FontKey, { label: string; css: string }> = {
  literata: { label: "Literata", css: '"Literata", "Iowan Old Style", Georgia, serif' },
  lora: { label: "Lora", css: '"Lora", Georgia, "Times New Roman", serif' },
  sans: { label: "Inter", css: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif' },
};

export const WIDTHS: Record<WidthKey, { label: string; rem: number }> = {
  narrow: { label: "Narrow", rem: 33 },
  medium: { label: "Medium", rem: 39 },
  wide: { label: "Wide", rem: 47 },
};

/** Text column width in rem. The slider runs from a narrow column to a much wider one. */
export const COLUMN_MIN = 24;
export const COLUMN_MAX = 90;
export const COLUMN_DEFAULT = WIDTHS.medium.rem;

export function columnRem(prefs: { column?: number; width?: WidthKey }): number {
  if (typeof prefs.column === "number" && Number.isFinite(prefs.column)) {
    return Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, Math.round(prefs.column)));
  }
  return WIDTHS[prefs.width ?? "medium"]?.rem ?? COLUMN_DEFAULT;
}

export const LEADINGS = [
  { label: "Tight", value: 1.6 },
  { label: "Normal", value: 1.8 },
  { label: "Loose", value: 2.05 },
] as const;

export const SIZE_MIN = 16;
export const SIZE_MAX = 30;

export type Prefs = {
  theme: Theme;
  font: FontKey;
  /** reading size in px */
  size: number;
  leading: number;
  /** Older saves use this. `column` wins when it is set. */
  width: WidthKey;
  /** Text column width in rem. */
  column: number;
  focus: boolean;
};

type PrefsState = Prefs & {
  set: (patch: Partial<Prefs>) => void;
};

const PREFS_KEY = "cibian-prefs-v1";

function safeStorage(): StateStorage {
  const none: StateStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  if (typeof window === "undefined") return none;
  return {
    getItem: (name) => {
      try {
        return localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        localStorage.setItem(name, value);
      } catch {
        // storage blocked or full: preferences just will not persist
      }
    },
    removeItem: (name) => {
      try {
        localStorage.removeItem(name);
      } catch {
        // see above
      }
    },
  };
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: "light",
      font: "literata",
      size: 20,
      leading: 1.8,
      width: "medium",
      column: COLUMN_DEFAULT,
      focus: false,
      set: (patch) => set(patch),
    }),
    {
      name: PREFS_KEY,
      skipHydration: true,
      storage: createJSONStorage(safeStorage),
      partialize: ({ theme, font, size, leading, width, column, focus }) => ({
        theme,
        font,
        size,
        leading,
        width,
        column,
        focus,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<Prefs>;
        return { ...current, ...saved, column: columnRem({ column: saved.column, width: saved.width ?? current.width }) };
      },
    },
  ),
);

/** Runs before first paint (inlined in <head>) so a dark/sepia reader never flashes white. */
export const THEME_BOOT_SCRIPT = `try{var p=JSON.parse(localStorage.getItem("${PREFS_KEY}")||"{}");var t=p.state&&p.state.theme;if(t==="dark"||t==="sepia"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  const color = theme === "dark" ? "#14161a" : theme === "sepia" ? "#f0e4c8" : "#f6f4ee";
  meta?.setAttribute("content", color);
}

/** CSS variables the reading surface reads (see `.book-body` in styles.css). */
export function readerVars(prefs: Prefs): Record<string, string> {
  return {
    "--reader-font": FONT_STACKS[prefs.font].css,
    "--reader-size": `${prefs.size / 16}rem`,
    "--reader-leading": String(prefs.leading),
    "--reader-width": `${columnRem(prefs)}rem`,
  };
}
