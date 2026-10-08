import { Heart } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { THANKS_NAMES, thanksFrame } from "@/lib/thanks-names";

/** How long one name stays before the next. Long enough to read, short enough to feel alive. */
const TURN_MS = 4000;

/**
 * The thank-you list, at the top of the overview. One name at a time, so the page
 * stays one screen when more people are added. Names are not invented here.
 */
export function ThanksSection() {
  const { t } = useT();
  const [index, setIndex] = useState(0);
  const frame = thanksFrame(THANKS_NAMES, index);

  useEffect(() => {
    if (THANKS_NAMES.length < 2) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    const timer = window.setInterval(() => setIndex((current) => current + 1), TURN_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section
      className="grid flex-1 content-center justify-items-center gap-3 text-center"
      id="thanks"
      data-thanks-page
      data-thanks-count={THANKS_NAMES.length}
    >
      <h1 className="flex items-center justify-center gap-2 font-display text-4xl font-semibold sm:text-5xl">
        <Heart className="size-7 text-accent sm:size-8" aria-hidden />
        {t("thanks.title")}
      </h1>
      <p className="max-w-md text-[1rem] leading-7 text-muted">{t("thanks.body")}</p>
      {frame ? (
        <p
          key={frame.name}
          className="thanks-name flex min-h-16 items-center justify-center font-display text-3xl font-semibold sm:text-4xl"
          data-thanks-name={frame.name}
          aria-live="polite"
        >
          {frame.name}
        </p>
      ) : (
        <p className="max-w-md text-[1.05rem] leading-7 text-muted" data-thanks-empty>
          {t("thanks.empty")}
        </p>
      )}
    </section>
  );
}
