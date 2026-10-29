import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRight, ExternalLink, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { btn, cn, panel, PanelHandle, Segmented, ThemeTiles } from "@/components/ui";
import { usePrefs } from "@/lib/reader-prefs";
import { useAccount } from "@/lib/account-store";
import { isSponsorAdmin } from "@/lib/sponsor";
import { navigate } from "@/lib/router";
import { LanguageSwitch } from "@/components/language";
import { guideUrl } from "@/lib/guide";
import { useTutorial } from "@/lib/tutorial";

/*
 * Settings. Books themselves are added on Discover only: public-domain packs download from their
 * card, and a word-list book asks for the reader's own EPUB there (the own-EPUB dialog).
 */

export function SettingsDialog({
  open,
  onOpenChange,
  onOpenGuide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenGuide: () => void;
}) {
  const { t } = useT();
  const theme = usePrefs((state) => state.theme);
  const pronunciationAccent = usePrefs((state) => state.pronunciationAccent);
  const setPrefs = usePrefs((state) => state.set);
  const role = useAccount((state) => state.role);
  const email = useAccount((state) => state.email);
  const isAdmin = role === "admin" || isSponsorAdmin(email);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={panel.overlay} />
        <Dialog.Content className={panel.content} data-settings-panel>
          <PanelHandle />
          <div className={panel.head}>
            <Dialog.Title className={panel.title}>{t("settings.title")}</Dialog.Title>
            <Dialog.Close className={cn(btn.icon, "-mr-2.5")} aria-label={t("common.close")}>
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{t("settings.desc")}</Dialog.Description>

          <section className={panel.group} aria-label={t("rs.theme")} data-settings-theme>
            <h3 className={panel.groupTitle}>{t("rs.theme")}</h3>
            <ThemeTiles
              label={t("rs.theme")}
              value={theme}
              onChange={(next) => setPrefs({ theme: next })}
              labels={{
                light: t("rs.theme.light"),
                sepia: t("rs.theme.sepia"),
                dark: t("rs.theme.dark"),
                eink: t("rs.theme.eink"),
              }}
            />
          </section>

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
                data-settings-guide
                onClick={() => {
                  onOpenChange(false);
                  onOpenGuide();
                }}
              >
                <span className={panel.rowLabel}>{t("nav.guide")}</span>
                <ChevronRight className={panel.rowIcon} aria-hidden />
              </button>
              <button
                type="button"
                className={panel.row}
                data-settings-tutorial
                onClick={() => {
                  onOpenChange(false);
                  useTutorial.getState().show();
                }}
              >
                <span className={panel.rowLabel}>{t("settings.tutorial")}</span>
                <ChevronRight className={panel.rowIcon} aria-hidden />
              </button>
              <a className={panel.row} href={guideUrl()} target="_blank" rel="noopener" data-guide-link>
                <span className={panel.rowLabel}>{t("settings.guide")}</span>
                <ExternalLink className={panel.rowIcon} aria-hidden />
              </a>
              {isAdmin ? (
                <button
                  type="button"
                  className={panel.row}
                  data-settings-admin
                  onClick={() => {
                    onOpenChange(false);
                    navigate({ kind: "admin" });
                  }}
                >
                  <span className={cn(panel.rowLabel, "font-bold text-accent")}>{t("admin.title")}</span>
                  <ChevronRight className={panel.rowIcon} aria-hidden />
                </button>
              ) : null}
            </div>
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
