import {
  BookPlus,
  Hand,
  Highlighter,
  Library,
  Lightbulb,
  NotebookPen,
  Scale,
  SearchCheck,
  ShieldCheck,
  SquareCode,
  UserRound,
  Users,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { guideUrl } from "@/lib/guide";
import { useT, type Key } from "@/lib/i18n";
import { CONTACT_EMAIL, CONTACT_URL } from "@/lib/site-info";

const SECTIONS: ReadonlyArray<{
  id: string;
  title: Key;
  body: Key;
  Icon: LucideIcon;
  marks?: boolean;
  source?: boolean;
}> = [
  { id: "add", title: "guide.addTitle", body: "guide.addBody", Icon: BookPlus },
  { id: "books", title: "about.booksTitle", body: "about.booksBody", Icon: Library },
  { id: "match", title: "about.matchTitle", body: "about.matchBody", Icon: SearchCheck },
  { id: "tap", title: "about.tapTitle", body: "about.tapBody", Icon: Hand },
  { id: "marks", title: "about.marksTitle", body: "about.markHard", Icon: Highlighter, marks: true },
  { id: "lists", title: "about.listsTitle", body: "about.listsBody", Icon: Users },
  { id: "wordbook", title: "about.wordbookTitle", body: "about.wordbookBody", Icon: NotebookPen },
  { id: "offline", title: "guide.offlineTitle", body: "guide.offlineBody", Icon: Wifi },
  { id: "account", title: "about.accountTitle", body: "about.accountBody", Icon: UserRound },
  { id: "privacy", title: "about.privacyTitle", body: "about.privacyBody", Icon: ShieldCheck },
  { id: "copyright", title: "about.copyrightTitle", body: "about.copyrightBody", Icon: Scale },
  { id: "source", title: "about.sourceTitle", body: "about.sourceBody", Icon: SquareCode, source: true },
];

/** The open-source reader this app was inspired by. MIT, Copyright (c) 2026 English Read contributors. */
const SOURCE_URL = "https://github.com/bitbw/english-read";

function SourceCredit() {
  const { t } = useT();
  const parts = t("about.sourceBody", { link: "\u0001" }).split("\u0001");
  return (
    <p className="text-[0.95rem] leading-7 text-ink">
      {parts[0]}
      <a
        className="font-semibold text-accent underline decoration-accent/40 underline-offset-4"
        href={SOURCE_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-guide-source
      >
        English Read <span className="font-normal">(github.com/<wbr />bitbw/<wbr />english-read)</span>
      </a>
      {parts[1]}
    </p>
  );
}

function Marks() {
  const { t } = useT();
  return (
    <ul className="grid gap-2 text-[0.95rem] leading-7" data-about-marks>
      <li>
        <span className="border-b-[1.5px] border-accent/60 pb-0.5 font-display" lang="en">
          hard
        </span>{" "}
        {t("about.markHard")}
      </li>
      <li data-about-tricky>
        <span
          className="font-display underline decoration-accent/80 decoration-wavy decoration-[1.2px] underline-offset-[0.3em]"
          lang="en"
        >
          well
        </span>{" "}
        {t("about.markTricky")}
      </li>
      <li>
        <Lightbulb className="mr-1 inline size-4 text-accent" aria-hidden />
        {t("about.markBulb")}
      </li>
    </ul>
  );
}

/**
 * One page for how to use the app and what the site is: adding books, marks, the notebook,
 * accounts, privacy, the copyright notice, the English Read credit, and contact.
 * The old About address opens this page.
 */
export function GuideScreen() {
  const { t } = useT();
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6 px-4 py-6 sm:px-6 sm:py-10" data-guide-page>
      <div className="grid gap-1.5">
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">{t("guide.title")}</h1>
        <p className="text-[1rem] leading-7 text-muted">{t("about.intro")}</p>
      </div>
      <ol className="grid gap-3">
        {SECTIONS.map((section, index) => (
          <li
            key={section.id}
            id={section.id}
            className="grid grid-cols-[auto_1fr] gap-x-4 rounded-2xl border border-line bg-card px-4 py-4 sm:px-5"
            data-guide-section={section.id}
          >
            <span
              className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent"
              aria-hidden
            >
              <section.Icon className="size-5" />
            </span>
            <div className="grid min-w-0 gap-1.5">
              <h2 className="font-display text-lg leading-snug font-semibold">
                <span className="sr-only">{index + 1}. </span>
                {t(section.title)}
              </h2>
              {section.marks ? (
                <Marks />
              ) : section.source ? (
                <SourceCredit />
              ) : (
                <p className="text-[0.95rem] leading-7 text-ink">{t(section.body)}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="rounded-2xl bg-accent-soft px-4 py-3 text-[0.95rem] leading-7" data-guide-contact>
        <span className="font-semibold">{t("about.contactTitle")}. </span>
        {t(CONTACT_EMAIL ? "about.contactEmail" : "about.contactIssues", { contact: "\u0001" })
          .split("\u0001")
          .flatMap((piece, i) =>
            i === 0
              ? [piece]
              : [
                  <a
                    key="c"
                    className="font-semibold text-accent underline underline-offset-4"
                    href={CONTACT_EMAIL ? `mailto:${CONTACT_EMAIL}` : CONTACT_URL}
                    {...(CONTACT_EMAIL ? {} : { target: "_blank", rel: "noopener" })}
                  >
                    {CONTACT_EMAIL || CONTACT_URL.replace("https://", "")}
                  </a>,
                  piece,
                ],
          )}
      </p>
      <p className="text-sm">
        <a className="inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-4" href={guideUrl()}>
          {t("settings.guide")}
        </a>
      </p>
    </div>
  );
}
