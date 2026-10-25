import { Avatar } from "@/components/avatar";
import { useContributor } from "@/lib/contributors";
import { useT } from "@/lib/i18n";

/**
 * "From <reader>" with their picture, above a meaning or a note a reader suggested. Shown only once
 * contributors.json names the reader, so a credit never shows an id or an email. A reader without a
 * nickname is "a reader".
 */
export function CreditLine({ id }: { id: string }) {
  const { t } = useT();
  const person = useContributor(id);
  if (!person) return null;
  const name = person.name || t("card.creditAnon");
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted" data-part="credit" data-credit={id}>
      <Avatar id={person.id} name={person.name} version={person.avatar} size={18} eager />
      <span className="min-w-0 truncate">{t("card.creditBy", { name })}</span>
    </p>
  );
}
