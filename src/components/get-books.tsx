import { ChevronRight, ExternalLink } from "lucide-react";
import { useT } from "@/lib/i18n";
import { panel, Segmented } from "@/components/ui";
import { usePrefs } from "@/lib/reader-prefs";
import { LanguageSwitch } from "@/components/language";
import { guideUrl } from "@/lib/guide";
import { useTutorialList, useTutorialNews } from "@/lib/tutorial";
import { NewTag } from "@/components/tutorial-tab";

/*
 * Settings. Books themselves are added on Discover only: public-domain packs download from their
 * card, and a word-list book asks for the reader's own EPUB there (the own-EPUB dialog).
 */

export function AccountPreferences({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useT();
  const tutorialNews = useTutorialNews();
  const pronunciationAccent = usePrefs((state) => state.pronunciationAccent);
  const setPrefs = usePrefs((state) => state.set);
  return (
    <div className="grid gap-5" data-account-preferences>
      <section className={panel.group} aria-label={t("settings.general")}>
        <h3 className={panel.groupTitle}>{t("settings.general")}</h3>
        <div className={panel.box}>
          <div className={panel.row} data-settings-language>
            <span>{t("settings.langTitle")}</span>
            <LanguageSwitch compact />
          </div>
          <div className={panel.row} data-settings-pronunciation>
            <span>{t("settings.pronunciation")}</span>
            <Segmented
              compact
              label={t("settings.pronunciation")}
              value={pronunciationAccent}
              onChange={(next) => setPrefs({ pronunciationAccent: next })}
              options={[
                { value: "UK" as const, label: t("ipa.uk") },
                { value: "US" as const, label: t("ipa.us") },
              ]}
            />
          </div>
        </div>
        <p className={panel.note}>{t("settings.pronunciationHelp")}</p>
      </section>

      <section className={panel.group} aria-label={t("settings.help")}>
        <h3 className={panel.groupTitle}>{t("settings.help")}</h3>
        <div className={panel.box}>
          <button
            type="button"
            className={panel.row}
            data-settings-tutorial
            onClick={() => {
              onDismiss();
              useTutorialList.getState().show("center");
            }}
          >
            <span className={panel.rowLabel}>
              {t("settings.tutorial")}
              {tutorialNews ? (
                <span className="ml-2 align-[1px]">
                  <NewTag />
                </span>
              ) : null}
            </span>
            <ChevronRight className={panel.rowIcon} aria-hidden />
          </button>
          <a className={panel.row} href={guideUrl()} target="_blank" rel="noopener" data-guide-link>
            <span className={panel.rowLabel}>{t("settings.guide")}</span>
            <ExternalLink className={panel.rowIcon} aria-hidden />
          </a>
        </div>
      </section>
    </div>
  );
}
