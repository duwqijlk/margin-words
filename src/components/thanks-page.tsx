import { Heart } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * A thank-you page for people who support the site. Names are not invented here:
 * the list stays empty until real names are added to the two language files.
 */
export function ThanksScreen() {
  const { t } = useT();
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6 px-4 py-6 sm:px-6 sm:py-10" data-thanks-page>
      <div className="grid gap-3">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Heart className="size-6" aria-hidden />
        </span>
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">{t("thanks.title")}</h1>
        <p className="text-[1rem] leading-7 text-muted">{t("thanks.body")}</p>
      </div>
      <p className="rounded-2xl border border-line bg-card px-5 py-8 text-center text-muted" data-thanks-empty>
        {t("thanks.empty")}
      </p>
    </div>
  );
}
