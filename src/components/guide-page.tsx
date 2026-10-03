import { BookPlus, BookText, Hand, Waves, WifiOff, type LucideIcon } from "lucide-react";
import { guideUrl } from "@/lib/guide";
import { useT, type Key } from "@/lib/i18n";

const SECTIONS: ReadonlyArray<{ title: Key; body: Key; Icon: LucideIcon }> = [
  { title: "guide.addTitle", body: "guide.addBody", Icon: BookPlus },
  { title: "guide.kindsTitle", body: "guide.kindsBody", Icon: BookText },
  { title: "guide.wordsTitle", body: "guide.wordsBody", Icon: Hand },
  { title: "guide.trickyTitle", body: "guide.trickyBody", Icon: Waves },
  { title: "guide.offlineTitle", body: "guide.offlineBody", Icon: WifiOff },
];

/** Short how-to. It lives in the app, so it works offline and follows the language switch. */
export function GuideScreen() {
  const { t } = useT();
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6 px-4 py-6 sm:px-6 sm:py-10" data-guide-page>
      <div className="grid gap-1.5">
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">{t("guide.title")}</h1>
        <p className="text-[0.95rem] leading-6 text-muted">{t("guide.intro")}</p>
      </div>
      <ol className="grid gap-3">
        {SECTIONS.map((section, index) => (
          <li
            key={section.title}
            className="grid grid-cols-[auto_1fr] gap-x-4 rounded-2xl border border-line bg-card px-4 py-4 sm:px-5"
          >
            <span
              className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent"
              aria-hidden
            >
              <section.Icon className="size-5" />
            </span>
            <div className="grid min-w-0 gap-1">
              <h2 className="font-display text-lg leading-snug font-semibold">
                <span className="sr-only">{index + 1}. </span>
                {t(section.title)}
              </h2>
              <p className="text-[0.95rem] leading-7 text-ink">{t(section.body)}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-sm">
        <a className="inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-4" href={guideUrl()}>
          {t("settings.guide")}
        </a>
      </p>
    </div>
  );
}
