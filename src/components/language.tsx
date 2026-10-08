import { LOCALES, useLocale, useT } from "@/lib/i18n";
import { Segmented } from "@/components/ui";

/** Language choice lives in Settings, not in the header. */
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
