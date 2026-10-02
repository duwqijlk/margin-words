import { guideUrl } from "@/lib/guide";
import { useT, type Key } from "@/lib/i18n";

const SECTIONS: ReadonlyArray<{ title: Key; body: Key }> = [
  { title: "guide.addTitle", body: "guide.addBody" },
  { title: "guide.kindsTitle", body: "guide.kindsBody" },
  { title: "guide.wordsTitle", body: "guide.wordsBody" },
  { title: "guide.offlineTitle", body: "guide.offlineBody" },
];

/** Short how-to. It lives in the app, so it works offline and follows the language switch. */
export function GuideScreen() {
  const { t } = useT();
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6 px-4 py-6 sm:px-6" data-guide-page>
      <div className="grid gap-2">
        <h1 className="font-display text-3xl font-semibold">{t("guide.title")}</h1>
        <p className="text-sm leading-6 text-muted">{t("guide.intro")}</p>
      </div>
      <ol className="grid gap-4">
        {SECTIONS.map((section, index) => (
          <li key={section.title} className="grid gap-1 rounded-2xl border border-line bg-card px-4 py-3">
            <h2 className="font-display text-lg font-semibold">
              <span className="mr-2 tabular-nums text-accent">{index + 1}.</span>
              {t(section.title)}
            </h2>
            <p className="text-sm leading-6 text-ink">{t(section.body)}</p>
          </li>
        ))}
      </ol>
      <p className="text-sm">
        <a className="font-semibold text-accent underline" href={guideUrl()}>
          {t("settings.guide")}
        </a>
      </p>
    </div>
  );
}
