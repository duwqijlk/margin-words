import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import {
  catalogUrlProblem,
  DEFAULT_CATALOG_URL,
  getCatalogUrl,
  setCatalogUrl,
} from "@/lib/packs";
import { btn, cn, field, Segmented } from "@/components/ui";
import { usePrefs } from "@/lib/reader-prefs";
import { LanguageSwitch } from "@/components/language";
import { AccountSection } from "@/components/account-dialog";
import { guideUrl } from "@/lib/guide";

/*
 * Settings. Books themselves are added on Discover only: public-domain packs download from their
 * card, and a word-list book asks for the reader's own EPUB there (the own-EPUB dialog).
 */

export function SettingsDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const theme = usePrefs((state) => state.theme);
  const setPrefs = usePrefs((state) => state.set);
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState("");
  useEffect(() => {
    if (open) {
      const now = getCatalogUrl();
      setValue(now === DEFAULT_CATALOG_URL ? "" : now);
      setProblem("");
    }
  }, [open]);

  function save(next: string) {
    const bad = catalogUrlProblem(next);
    if (bad) {
      setProblem(t(bad));
      return;
    }
    setCatalogUrl(next);
    onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <Dialog.Content className="anim-pop fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-card p-5 text-ink shadow-pop sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-display text-2xl font-semibold">
              {t("settings.title")}
            </Dialog.Title>
            <Dialog.Close className={cn(btn.icon, "-mt-1 -mr-2")} aria-label={t("common.close")}>
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{t("settings.desc")}</Dialog.Description>
          <section
            className="mt-5 grid gap-2"
            aria-label={t("settings.langTitle")}
            data-settings-language
          >
            <h3 className="text-sm font-semibold">{t("settings.langTitle")}</h3>
            <LanguageSwitch />
          </section>
          <section className="mt-5 grid gap-2" aria-label={t("rs.theme")} data-settings-theme>
            <h3 className="text-sm font-semibold">{t("rs.theme")}</h3>
            <Segmented
              label={t("rs.theme")}
              value={theme}
              onChange={(next) => setPrefs({ theme: next })}
              options={[
                { value: "light" as const, label: t("rs.theme.light") },
                { value: "sepia" as const, label: t("rs.theme.sepia") },
                { value: "dark" as const, label: t("rs.theme.dark") },
              ]}
            />
          </section>
          <AccountSection beforeOpen={() => onOpenChange(false)} />
          <details
            className="mt-5 rounded-xl border border-line px-4 py-1 open:pb-4"
            data-settings-advanced
          >
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">
              {t("settings.advanced")}
            </summary>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                save(value);
              }}
            >
              <label className="grid gap-1 text-sm font-medium">
                {t("settings.catalogLabel")}
                <input
                  className={field}
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setProblem("");
                  }}
                  placeholder={t("settings.placeholder", { url: DEFAULT_CATALOG_URL })}
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={Boolean(problem)}
                />
              </label>
              <p className="text-xs text-muted">{t("settings.help")}</p>
              {problem ? (
                <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
                  {problem}
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <button type="button" className={btn.quiet} onClick={() => save("")}>
                  {t("settings.useBuiltin")}
                </button>
                <button type="submit" className={btn.primary}>
                  {t("common.save")}
                </button>
              </div>
            </form>
          </details>
          <a
            className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-accent underline"
            href={guideUrl()}
            target="_blank"
            rel="noopener"
            data-guide-link
          >
            {t("settings.guide")}
          </a>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
