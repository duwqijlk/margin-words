import { Heart } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * The thank-you list. It sits on the overview page. Names are not invented here:
 * the list stays empty until real names are added to the two language files.
 */
export function ThanksSection() {
  const { t } = useT();
  return (
    <section className="grid scroll-mt-20 gap-3" id="thanks" data-thanks-page>
      <div className="grid gap-1.5">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
          <Heart className="size-5 text-accent" aria-hidden />
          {t("thanks.title")}
        </h2>
        <p className="max-w-2xl text-[1rem] leading-7 text-muted">{t("thanks.body")}</p>
      </div>
      <p className="rounded-2xl border border-line bg-card px-5 py-8 text-center text-muted" data-thanks-empty>
        {t("thanks.empty")}
      </p>
    </section>
  );
}
