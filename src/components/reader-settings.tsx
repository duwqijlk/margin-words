import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { Type, X } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { useT, type Key } from "@/lib/i18n";
import {
  COLUMN_MAX,
  COLUMN_MIN,
  FONT_STACKS,
  LEADINGS,
  SIZE_MAX,
  SIZE_MIN,
  usePrefs,
  type FontKey,
} from "@/lib/reader-prefs";
import { btn, cn, panel, PanelHandle, Segmented, Switch, ThemeTiles } from "@/components/ui";

const LEADING_LABEL: Record<number, Key> = {
  1.6: "rs.leading.tight",
  1.8: "rs.leading.normal",
  2.05: "rs.leading.loose",
};
/** The gap drawn in each line-spacing icon. */
const LEADING_GAP: Record<number, number> = { 1.6: 2, 1.8: 3, 2.05: 4 };

const PHONE = "(max-width: 639px)";
function subscribePhone(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(PHONE);
  // MediaQueryList.addEventListener needs Chrome 76 (iOS 14); the e-ink WebViews (Chrome 69) have addListener.
  if (typeof query.addEventListener === "function") query.addEventListener("change", onChange);
  else query.addListener(onChange);
  return () => {
    if (typeof query.removeEventListener === "function") query.removeEventListener("change", onChange);
    else query.removeListener(onChange);
  };
}
function phoneNow(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(PHONE).matches;
}

function Section({ title, value, children }: { title: string; value?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-2" aria-label={title}>
      <h3 className="m-0 flex justify-between text-[13px] font-bold text-faint">
        {title}
        {value !== undefined ? <em className="font-normal not-italic [font-variant-numeric:tabular-nums]">{value}</em> : null}
      </h3>
      {children}
    </section>
  );
}

/**
 * The reading settings (design system ReaderSettings), opened from Aa in the reader bar: the four
 * themes as small pages, the three fonts as "Aa" cards, size with a small and a big A at the ends
 * of the slider, line spacing with a drawing of each gap, page width, and Focus mode and Hide
 * underlines as switches. Every change shows at once in the page behind. A popover with a little
 * point under Aa on a wide screen, a bottom sheet on a phone.
 */
function SettingsBody() {
  const { t } = useT();
  const prefs = usePrefs();
  const set = usePrefs((state) => state.set);
  return (
    <div className="grid gap-4" data-reader-settings>
      <Section title={t("rs.theme")}>
        <ThemeTiles
          small
          label={t("rs.theme")}
          value={prefs.theme}
          onChange={(theme) => set({ theme })}
          labels={{ light: t("rs.theme.light"), sepia: t("rs.theme.sepia"), dark: t("rs.theme.dark"), eink: t("rs.theme.eink") }}
        />
      </Section>

      <Section title={t("rs.font")}>
        <div role="group" aria-label={t("rs.font")} className="grid grid-cols-3 gap-2">
          {(Object.keys(FONT_STACKS) as FontKey[]).map((key) => {
            const on = prefs.font === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => set({ font: key })}
                data-reader-font={key}
                className={cn(
                  "grid min-h-16 content-center justify-items-center gap-0.5 rounded border p-1.5 text-ink transition-[background-color,border-color,transform] duration-100 active:scale-[0.96]",
                  on ? "border-accent bg-accent-soft shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb))]" : "border-edge bg-paper hover:bg-sheet",
                )}
              >
                <b className="text-[22px] leading-none font-semibold" style={{ fontFamily: FONT_STACKS[key].css }}>
                  Aa
                </b>
                <span className={cn("text-xs", on ? "font-bold text-accent" : "text-muted")}>{FONT_STACKS[key].label}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title={t("rs.size")} value={`${prefs.size}px`}>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
          <button
            type="button"
            className="grid size-10 place-items-center rounded border border-edge text-ink hover:bg-sheet disabled:opacity-40"
            aria-label={t("rs.smaller")}
            disabled={prefs.size <= SIZE_MIN}
            onClick={() => set({ size: Math.max(SIZE_MIN, prefs.size - 1) })}
          >
            <b className="font-display text-[13px] leading-none font-semibold" aria-hidden>
              A
            </b>
          </button>
          <input
            type="range"
            min={SIZE_MIN}
            max={SIZE_MAX}
            step={1}
            value={prefs.size}
            onChange={(event) => set({ size: Number(event.target.value) })}
            aria-label={t("rs.size")}
            className="h-11 w-full cursor-pointer accent-[var(--accent)]"
          />
          <button
            type="button"
            className="grid size-10 place-items-center rounded border border-edge text-ink hover:bg-sheet disabled:opacity-40"
            aria-label={t("rs.bigger")}
            disabled={prefs.size >= SIZE_MAX}
            onClick={() => set({ size: Math.min(SIZE_MAX, prefs.size + 1) })}
          >
            <b className="font-display text-xl leading-none font-semibold" aria-hidden>
              A
            </b>
          </button>
        </div>
      </Section>

      <Section title={t("rs.leading")}>
        <Segmented
          label={t("rs.leading")}
          value={prefs.leading}
          onChange={(value) => set({ leading: value })}
          options={LEADINGS.map((item) => ({
            value: item.value as number,
            label: (
              <span className="inline-flex items-center justify-center gap-1.5">
                <span className="inline-grid w-3.5" style={{ gap: LEADING_GAP[item.value] ?? 3 }} aria-hidden>
                  <i className="block h-0.5 rounded-sm bg-current" />
                  <i className="block h-0.5 rounded-sm bg-current" />
                  <i className="block h-0.5 rounded-sm bg-current" />
                </span>
                {t(LEADING_LABEL[item.value] ?? "rs.leading.normal")}
              </span>
            ),
          }))}
        />
      </Section>

      <Section title={t("rs.width")} value={prefs.column}>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
          <span className="min-w-6 text-center text-[13px] text-faint">{t("rs.width.narrow")}</span>
          <input
            type="range"
            min={COLUMN_MIN}
            max={COLUMN_MAX}
            step={1}
            value={prefs.column}
            onChange={(event) => set({ column: Number(event.target.value) })}
            aria-label={t("rs.width")}
            data-reader-width
            className="h-11 w-full cursor-pointer accent-[var(--accent)]"
          />
          <span className="min-w-6 text-center text-[13px] text-faint">{t("rs.width.wide")}</span>
        </div>
      </Section>

      <div className="grid rounded bg-sheet px-3.5 [&>*+*]:border-t [&>*+*]:border-line">
        <div className="flex min-h-[52px] items-center justify-between gap-4">
          <span className="min-w-0 text-[15px] font-bold">
            {t("rs.focus")}
            <small className="block text-[13px] font-normal text-faint">{t("rs.focusHint")}</small>
          </span>
          <Switch checked={prefs.focus} onChange={(focus) => set({ focus })} label={t("rs.focus")} data-reader-focus />
        </div>
        <div className="flex min-h-[52px] items-center justify-between gap-4">
          <span className="min-w-0 text-[15px] font-bold">
            {t("rs.quietMarks")}
            <small className="block text-[13px] font-normal text-faint">{t("rs.quietMarksHint")}</small>
          </span>
          <Switch checked={!prefs.quietMarks} onChange={(showHints) => set({ quietMarks: !showHints })} label={t("rs.quietMarks")} data-reader-quiet-marks />
        </div>
      </div>
    </div>
  );
}

const trigger = cn(btn.icon, "data-[state=open]:bg-sheet data-[state=open]:text-accent");

export function ReaderSettings() {
  const { t } = useT();
  const phone = useSyncExternalStore(subscribePhone, phoneNow, () => false);
  if (phone) {
    return (
      <Dialog.Root>
        <Dialog.Trigger className={trigger} aria-label={t("rs.aria")}>
          <Type className="size-5" aria-hidden />
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className={panel.overlay} />
          <Dialog.Content className={cn(panel.content, "max-sm:gap-3")} aria-describedby={undefined}>
            <PanelHandle />
            <div className={panel.head}>
              <Dialog.Title className="m-0 text-lg font-bold tracking-[-0.02em]">{t("rs.title")}</Dialog.Title>
              <Dialog.Close className={cn(btn.icon, "-mr-2.5")} aria-label={t("common.close")}>
                <X className="size-5" aria-hidden />
              </Dialog.Close>
            </div>
            <SettingsBody />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }
  return (
    <Popover.Root>
      <Popover.Trigger className={trigger} aria-label={t("rs.aria")}>
        <Type className="size-5" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          alignOffset={-8}
          sideOffset={8}
          collisionPadding={8}
          aria-label={t("rs.aria")}
          className="anim-pop z-50 max-h-[calc(100dvh-5rem)] w-[min(22rem,calc(100vw-1rem))] overflow-y-auto rounded-2xl border border-line bg-card p-4 text-ink shadow-[0_2px_6px_rgb(0_0_0/0.06),0_24px_48px_-16px_rgb(0_0_0/0.25)]"
        >
          <SettingsBody />
          <Popover.Arrow width={14} height={7} className="fill-card stroke-line" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
