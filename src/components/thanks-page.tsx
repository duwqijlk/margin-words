import { Heart } from "lucide-react";
import { useEffect, useState } from "react";
import { SponsorDialog } from "@/components/sponsor-dialog";
import { btn } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { formatSponsorUsd, readSponsorLines, type SponsorLine } from "@/lib/sponsor";

/** How long one name stays before the next. Long enough to read, short enough to feel alive. */
const TURN_MS = 4000;

function useTurn(count: number): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (count < 2) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    const timer = window.setInterval(() => setIndex((current) => current + 1), TURN_MS);
    return () => window.clearInterval(timer);
  }, [count]);
  return index;
}

function NameColumn({
  title,
  lines,
  empty,
  marker,
}: {
  title: string;
  lines: readonly SponsorLine[];
  empty: string;
  marker: "month" | "total";
}) {
  const { t } = useT();
  const index = useTurn(lines.length);
  const at = lines.length === 0 ? 0 : ((Math.floor(index) % lines.length) + lines.length) % lines.length;
  const line = lines[at];
  return (
    <div className="grid justify-items-center gap-1 text-center" data-sponsor-column={marker}>
      <h2 className="text-sm font-semibold text-muted">{title}</h2>
      {line ? (
        <p key={`${marker}-${at}-${line.name}`} className="thanks-name grid gap-0.5" data-sponsor-name={line.name}>
          <span className="font-display text-2xl font-semibold sm:text-3xl">{line.name}</span>
          <span className="text-sm tabular-nums text-muted">{t("thanks.amount", { amount: formatSponsorUsd(line.cents) })}</span>
        </p>
      ) : (
        <p className="text-sm leading-6 text-muted" data-sponsor-empty={marker}>
          {empty}
        </p>
      )}
    </div>
  );
}

/**
 * The thank-you list, at the top of the overview. Two columns, one name at a time,
 * so a longer list still fits on one screen. Names come from confirmed sponsorships.
 */
export function ThanksSection() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [month, setMonth] = useState<SponsorLine[]>([]);
  const [total, setTotal] = useState<SponsorLine[]>([]);

  useEffect(() => {
    let alive = true;
    void fetch("/api/sponsorships", { credentials: "same-origin" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!alive || !payload || typeof payload !== "object") return;
        const body = payload as { month?: unknown; total?: unknown };
        setMonth(readSponsorLines(body.month));
        setTotal(readSponsorLines(body.total));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [reload]);

  return (
    <section className="grid flex-1 content-center justify-items-center gap-3 text-center" id="thanks" data-thanks-page>
      <h1 className="flex items-center justify-center gap-2 font-display text-3xl font-semibold sm:text-4xl">
        <Heart className="size-6 text-accent sm:size-7" aria-hidden />
        {t("thanks.title")}
      </h1>
      <p className="max-w-md text-[0.95rem] leading-6 font-semibold">{t("thanks.gift")}</p>
      <p className="max-w-md text-[0.95rem] leading-6 text-muted">{t("thanks.body")}</p>
      <button type="button" className={btn.primary} onClick={() => setOpen(true)} data-sponsor-button>
        {t("thanks.sponsor")}
      </button>
      <div className="grid w-full max-w-lg grid-cols-2 gap-4">
        <NameColumn title={t("thanks.month")} lines={month} empty={t("thanks.monthEmpty")} marker="month" />
        <NameColumn title={t("thanks.total")} lines={total} empty={t("thanks.totalEmpty")} marker="total" />
      </div>
      <SponsorDialog open={open} onOpenChange={setOpen} onSubmitted={() => setReload((n) => n + 1)} />
    </section>
  );
}
