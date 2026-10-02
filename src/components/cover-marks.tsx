import { useT } from "@/lib/i18n";

/** Warm badge on the cover when the English is too old for a beginner. */
export function OldFashionedBadge({ reason }: { reason?: string }) {
  const { t } = useT();
  const note = t("shelf.oldFashionedNote");
  const tip = reason ? `${note} — ${reason}` : note;
  return (
    <span
      className="pointer-events-auto max-w-full rounded-full bg-[#f4e4d4] px-2 py-0.5 text-left text-[0.68rem] leading-4 font-bold text-[#6b3e22] shadow-sm ring-1 ring-[#8a5a3c]/40"
      data-old-fashioned=""
      title={tip}
      role="img"
      aria-label={tip}
    >
      {t("shelf.oldFashioned")}
    </span>
  );
}
