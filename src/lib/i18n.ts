/**
 * A tiny, dependency-free translation layer: two languages ("en" and "zh").
 *
 * - The words on screen live in two dictionaries with the same keys: src/lib/i18n-en.ts and
 *   src/lib/i18n-zh.ts. A key that is missing in one of them fails `npx tsc --noEmit`.
 * - Only the app's own words are translated. Book content (meanings, paragraph help, sentence help,
 *   phrases, example sentences, book titles) comes from the book's word list and stays English.
 * - The choice is saved in localStorage. Without a saved choice, a browser in Chinese (zh, zh-CN, zh-TW ...)
 *   gets Chinese and every other browser gets English.
 */
import { useMemo } from "react";
import { create } from "zustand";
import { CodedError } from "./errors.ts";
import { en, type Key } from "./i18n-en.ts";
import { zh, ZH_NAME } from "./i18n-zh.ts";

export type { Key };
export type Locale = "en" | "zh";
export type Params = Record<string, string | number>;

export const LOCALE_KEY = "cibian-locale-v1";
export const LOCALES: ReadonlyArray<{ value: Locale; name: string }> = [
  { value: "zh", name: ZH_NAME },
  { value: "en", name: "English" },
];

const DICTS: Record<Locale, Record<Key, string>> = { en, zh };

/** Saved choice first, else the browser language: zh* -> zh, anything else -> en. */
export function detectLocale(
  saved: string | null | undefined,
  browser: string | null | undefined,
): Locale {
  if (saved === "zh" || saved === "en") return saved;
  return /^zh\b/i.test(browser ?? "") ? "zh" : "en";
}

function initialLocale(): Locale {
  let saved: string | null = null;
  try {
    saved = typeof localStorage === "undefined" ? null : localStorage.getItem(LOCALE_KEY);
  } catch {
    saved = null;
  }
  const browser = typeof navigator === "undefined" ? "en" : navigator.language;
  return detectLocale(saved, browser);
}

function applyDocumentLang(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("lang", locale === "zh" ? "zh-CN" : "en");
}

/** Fill {name} places in a text. */
export function format(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

export function translate(locale: Locale, key: Key, params?: Params): string {
  return format(DICTS[locale][key] ?? en[key] ?? key, params);
}

/** For counts: uses "<base>.one" when n is 1, else "<base>.other". The number is available as {n}. */
export type PluralBase = Key extends infer K ? (K extends `${infer B}.one` ? B : never) : never;
export function translatePlural(
  locale: Locale,
  base: PluralBase,
  n: number,
  params?: Params,
): string {
  return translate(locale, `${base}.${n === 1 ? "one" : "other"}` as Key, { n, ...params });
}

type LocaleState = { locale: Locale; setLocale: (locale: Locale) => void };

export const useLocale = create<LocaleState>()((set) => ({
  locale: initialLocale(),
  setLocale: (locale) => {
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // Blocked storage: the choice just lasts until the page is closed.
    }
    set({ locale });
  },
}));

applyDocumentLang(useLocale.getState().locale);
useLocale.subscribe((state) => applyDocumentLang(state.locale));

// Another tab changed the language.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === LOCALE_KEY && (event.newValue === "zh" || event.newValue === "en"))
      useLocale.setState({ locale: event.newValue });
  });
}

/** Translate outside React (messages made by plain functions). Uses the language chosen right now. */
export function tr(key: Key, params?: Params): string {
  return translate(useLocale.getState().locale, key, params);
}
export function trn(base: PluralBase, n: number, params?: Params): string {
  return translatePlural(useLocale.getState().locale, base, n, params);
}

export type T = {
  locale: Locale;
  t: (key: Key, params?: Params) => string;
  tn: (base: PluralBase, n: number, params?: Params) => string;
};

/** In a component: `const { t, tn, locale } = useT();` The component redraws when the language changes. */
export function useT(): T {
  const locale = useLocale((state) => state.locale);
  return useMemo(
    () => ({
      locale,
      t: (key, params) => translate(locale, key, params),
      tn: (base, n, params) => translatePlural(locale, base, n, params),
    }),
    [locale],
  );
}

/** Words for an error that is shown to the person. Our own errors are translated; anything else keeps its text. */
export function errorText(reason: unknown, fallback: Key): string {
  if (reason instanceof CodedError) return tr(`err.${reason.code}` as Key);
  if (reason instanceof Error && reason.message) return reason.message;
  return tr(fallback);
}
