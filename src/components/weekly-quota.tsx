import * as Popover from "@radix-ui/react-popover";
import { Info } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/components/ui";
import { useCanAddBooks } from "@/lib/can-add";
import { dayLabel, placesLeft, useGlossaryQuota, type QuotaCount } from "@/lib/glossary-quota";
import { useT, type Key } from "@/lib/i18n";

const RULES: Key[] = ["quota.rule1", "quota.rule2", "quota.rule3", "quota.rule4"];

function Count({ count, label }: { count: QuotaCount; label: Key }) {
  const { t } = useT();
  const left = placesLeft(count);
  return (
    <span
      className={cn(left === 0 ? "text-warn" : "")}
      data-quota-left={left}
    >
      {t(label)}{" "}
      <b className={cn("font-bold tabular-nums", left === 0 ? "text-warn" : "text-muted")}>
        {left}/{count.limit}
      </b>
      {left === 0 && count.resetAt ? (
        <span className="font-normal" data-quota-back>
          {" "}
          {t("quota.backShort", { day: dayLabel(count.resetAt) })}
        </span>
      ) : null}
    </span>
  );
}

/**
 * One quiet line beside the Discover tabs (under them on a phone, or when the two do not fit on one
 * line): how many new novels and speeches this reader may still
 * open this week, with the rules behind an info button. Hidden when signed out or not limited.
 */
export function WeeklyQuota() {
  const { t } = useT();
  const canAdd = useCanAddBooks();
  const quota = useGlossaryQuota((state) => state.quota);
  useEffect(() => {
    if (canAdd) void useGlossaryQuota.getState().refresh();
    else useGlossaryQuota.setState({ quota: null });
  }, [canAdd]);
  if (!canAdd || !quota || quota.unlimited) return null;
  const info = (
    <Popover.Root>
      <Popover.Trigger
        className="ml-0.5 inline-flex size-8 items-center justify-center rounded text-faint hover:bg-sheet hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={t("quota.rulesOpen")}
        data-quota-rules
      >
        <Info className="size-4" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="anim-pop z-50 grid w-[min(22rem,calc(100vw-1rem))] gap-2 rounded-2xl border border-float-edge bg-float p-4 text-sm text-ink shadow-lift "
        >
          <h3 className="font-semibold">{t("quota.rulesTitle")}</h3>
          <ul className="grid list-disc gap-1.5 pl-4 leading-snug text-muted">
            {RULES.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
  return (
    <div
      className="ml-auto flex min-w-0 flex-wrap items-center gap-x-1 text-[0.8125rem] text-faint max-sm:ml-0 max-sm:basis-full max-sm:pt-1.5"
      data-weekly-quota
    >
      <span>{t("quota.left")}</span>
      {/* Each count keeps its separator, and the last one keeps the info button, so a wrap never
          leaves a lone "·" or a lone button at the start or end of a line. */}
      <span className="inline-flex items-center whitespace-nowrap">
        <Count count={quota.novel} label="quota.novels" />
        {quota.speech ? null : info}
      </span>
      {quota.speech ? (
        <span className="inline-flex items-center whitespace-nowrap">
          <span aria-hidden className="mr-1">
            ·
          </span>
          <Count count={quota.speech} label="quota.speeches" />
          {info}
        </span>
      ) : null}
    </div>
  );
}
