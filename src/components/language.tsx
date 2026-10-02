import { Languages } from "lucide-react";
import { LOCALES, useLocale, useT } from "@/lib/i18n";
import { cn, Segmented } from "@/components/ui";

/** Small button in the top bar. It shows the language you can switch TO. */
export function LanguageButton() {
  const { t, locale } = useT();
  const setLocale = useLocale((state) => state.setLocale);
  const current = LOCALES.find((item) => item.value === locale)?.name ?? "";
  const other = LOCALES.find((item) => item.value !== locale);
  if (!other) return null;
  return (
    <button
      type="button"
      data-lang-button
      onClick={() => setLocale(other.value)}
      aria-label={t("lang.switchAria", { current })}
      title={t("lang.switchAria", { current })}
      className={cn(
        "inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg px-1.5 text-sm font-semibold text-ink transition-colors hover:bg-accent-soft sm:px-2",
      )}
    >
      <Languages className="size-4 text-muted max-sm:hidden" aria-hidden />
      <span lang={other.value === "zh" ? "zh-CN" : "en"}>{other.name}</span>
    </button>
  );
}

/** Two-part switch for the Settings dialog. */
export function LanguageSwitch() {
  const { t, locale } = useT();
  const setLocale = useLocale((state) => state.setLocale);
  return (
    <Segmented
      label={t("lang.groupAria")}
      value={locale}
      onChange={setLocale}
      options={LOCALES.map((item) => ({
        value: item.value,
        label: <span lang={item.value === "zh" ? "zh-CN" : "en"}>{item.name}</span>,
      }))}
    />
  );
}
