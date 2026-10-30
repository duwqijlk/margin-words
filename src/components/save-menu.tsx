import * as Menu from "@radix-ui/react-dropdown-menu";
import { BookmarkCheck, Quote, TextCursor } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { btn, cn } from "@/components/ui";

const item =
  "grid min-h-12 cursor-pointer grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-1.5 text-left text-[15px] leading-snug font-semibold outline-none data-[highlighted]:bg-sheet data-[disabled]:cursor-default data-[disabled]:opacity-45";

/**
 * The reader bar's bookmark (design system SaveMenu): one button for everything kept from the
 * book, so the bar does not gain an icon per kind. It opens Notebook · count, Quotes · count and,
 * under a rule (it is an action, not a page), Pick sentences, which turns pick mode on or off. The button stays
 * green while the menu is open and while pick mode is on.
 */
export function SaveMenu({
  words,
  quotes,
  picking,
  canPick,
  onWords,
  onQuotes,
  onPick,
}: {
  words: number;
  quotes: number;
  picking: boolean;
  /** False where a quote cannot be kept (an extra page with no chapter number, a book not on the shelf). */
  canPick: boolean;
  onWords: () => void;
  onQuotes: () => void;
  onPick: () => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const on = open || picking;
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger
        className={cn(btn.icon, on && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent")}
        aria-label={t("save.aria")}
        data-reader-notebook
        data-save-menu={on ? "on" : "off"}
      >
        <BookmarkCheck className="size-5" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="anim-pop z-50 grid w-[232px] rounded-2xl border border-float-edge bg-float p-1.5 text-ink shadow-pop"
          data-save-menu-list
        >
          <Menu.Item className={item} onSelect={onWords} data-save-item="words">
            <BookmarkCheck className="size-5 text-accent" aria-hidden />
            <span>{t("save.words")}</span>
            <small className="text-[13px] font-normal text-faint [font-variant-numeric:tabular-nums]">{words.toLocaleString()}</small>
          </Menu.Item>
          <Menu.Item className={item} onSelect={onQuotes} data-save-item="quotes">
            <Quote className="size-5 text-accent" aria-hidden />
            <span>{t("save.quotes")}</span>
            <small className="text-[13px] font-normal text-faint [font-variant-numeric:tabular-nums]">{quotes.toLocaleString()}</small>
          </Menu.Item>
          <Menu.Separator className="mx-2 my-1 h-px bg-line" />
          <Menu.Item className={item} onSelect={onPick} disabled={!canPick && !picking} data-save-item="pick">
            <TextCursor className="size-5 text-accent" aria-hidden />
            <span className="grid">
              {picking ? t("save.pickOff") : t("save.pick")}
              <em className="text-xs font-normal text-faint not-italic">{t("save.pickHint")}</em>
            </span>
            <span />
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
