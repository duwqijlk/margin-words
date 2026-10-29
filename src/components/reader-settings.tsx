import * as Popover from "@radix-ui/react-popover";
import { Check, Focus, Minus, Plus, Type, Underline } from "lucide-react";
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
  type Theme,
} from "@/lib/reader-prefs";
import { btn, cn, Segmented } from "@/components/ui";

const THEMES: Array<{ value: Theme; label: Key; bg: string; fg: string }> = [
  { value: "light", label: "rs.theme.light", bg: "#faf8f3", fg: "#1b1a17" },
  { value: "sepia", label: "rs.theme.sepia", bg: "#f4ecdc", fg: "#2c2318" },
  { value: "dark", label: "rs.theme.dark", bg: "#121412", fg: "#e7e4dc" },
  { value: "eink", label: "rs.theme.eink", bg: "#ffffff", fg: "#000000" },
];

const LEADING_LABEL: Record<number, Key> = {
  1.6: "rs.leading.tight",
  1.8: "rs.leading.normal",
  2.05: "rs.leading.loose",
};

export function ReaderSettings() {
  const { t } = useT();
  const prefs = usePrefs();
  const set = usePrefs((state) => state.set);
  return (
    <Popover.Root>
      <Popover.Trigger className={btn.icon} aria-label={t("rs.aria")}>
        <Type className="size-5" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="anim-pop z-50 grid w-[min(22rem,calc(100vw-1rem))] gap-4 rounded-2xl border border-line bg-paper p-4 text-ink shadow-lift "
        >
          <section className="grid gap-2" aria-label={t("rs.theme")}>
            <h3 className="text-xs font-semibold text-muted">{t("rs.theme")}</h3>
            <div className="grid grid-cols-4 gap-2">
              {THEMES.map((theme) => (
                <button
                  key={theme.value}
                  type="button"
                  aria-pressed={prefs.theme === theme.value}
                  onClick={() => set({ theme: theme.value })}
                  className={cn(
                    "grid min-h-16 place-items-center gap-0.5 rounded-xl border-2 py-2 text-xs font-semibold transition-colors",
                    prefs.theme === theme.value
                      ? "border-accent"
                      : "border-line hover:border-muted",
                  )}
                  style={{ background: theme.bg, color: theme.fg }}
                >
                  <span className="font-display text-lg leading-none">Aa</span>
                  {t(theme.label)}
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-2" aria-label={t("rs.font")}>
            <h3 className="text-xs font-semibold text-muted">{t("rs.font")}</h3>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(FONT_STACKS) as FontKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={prefs.font === key}
                  onClick={() => set({ font: key })}
                  className={cn(
                    "min-h-11 rounded-lg border px-2 text-base transition-colors",
                    prefs.font === key
                      ? "border-accent bg-accent-soft"
                      : "border-line hover:bg-accent-soft/60",
                  )}
                  style={{ fontFamily: FONT_STACKS[key].css }}
                >
                  {FONT_STACKS[key].label}
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-2" aria-label={t("rs.size")}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-muted">{t("rs.size")}</h3>
              <span className="text-xs tabular-nums text-muted">{prefs.size}px</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={btn.icon}
                aria-label={t("rs.smaller")}
                disabled={prefs.size <= SIZE_MIN}
                onClick={() => set({ size: Math.max(SIZE_MIN, prefs.size - 1) })}
              >
                <Minus className="size-4" aria-hidden />
              </button>
              <input
                type="range"
                min={SIZE_MIN}
                max={SIZE_MAX}
                step={1}
                value={prefs.size}
                onChange={(event) => set({ size: Number(event.target.value) })}
                aria-label={t("rs.size")}
                className="h-11 flex-1 accent-[var(--accent)]"
              />
              <button
                type="button"
                className={btn.icon}
                aria-label={t("rs.bigger")}
                disabled={prefs.size >= SIZE_MAX}
                onClick={() => set({ size: Math.min(SIZE_MAX, prefs.size + 1) })}
              >
                <Plus className="size-4" aria-hidden />
              </button>
            </div>
          </section>

          <section className="grid gap-2" aria-label={t("rs.leading")}>
            <h3 className="text-xs font-semibold text-muted">{t("rs.leading")}</h3>
            <Segmented
              label={t("rs.leading")}
              value={prefs.leading}
              onChange={(value) => set({ leading: value })}
              options={LEADINGS.map((item) => ({
                value: item.value as number,
                label: t(LEADING_LABEL[item.value] ?? "rs.leading.normal"),
              }))}
            />
          </section>

          <section className="grid gap-2" aria-label={t("rs.width")}>
            <h3 className="text-xs font-semibold text-muted">
              {t("rs.width")} <span className="tabular-nums">{prefs.column}</span>
            </h3>
            <div className="flex items-center gap-2">
              <span className="w-10 text-xs text-muted">{t("rs.width.narrow")}</span>
              <input
                type="range"
                min={COLUMN_MIN}
                max={COLUMN_MAX}
                step={1}
                value={prefs.column}
                onChange={(event) => set({ column: Number(event.target.value) })}
                aria-label={t("rs.width")}
                data-reader-width
                className="h-11 flex-1 accent-[var(--accent)]"
              />
              <span className="w-10 text-right text-xs text-muted">{t("rs.width.wide")}</span>
            </div>
          </section>

          <button
            type="button"
            aria-pressed={prefs.focus}
            onClick={() => set({ focus: !prefs.focus })}
            className={cn(
              "flex min-h-11 items-center justify-between rounded-lg border px-3 text-sm font-semibold",
              prefs.focus ? "border-accent bg-accent-soft" : "border-line",
            )}
          >
            <span className="flex items-center gap-2">
              <Focus className="size-4" aria-hidden />
              {t("rs.focus")}
              <span className="font-normal text-muted">{t("rs.focusHint")}</span>
            </span>
            {prefs.focus ? <Check className="size-4 text-accent" aria-hidden /> : null}
          </button>

          <button
            type="button"
            aria-pressed={prefs.quietMarks}
            onClick={() => set({ quietMarks: !prefs.quietMarks })}
            className={cn(
              "flex min-h-11 items-center justify-between rounded-lg border px-3 text-left text-sm font-semibold",
              prefs.quietMarks ? "border-accent bg-accent-soft" : "border-line",
            )}
            data-reader-quiet-marks
          >
            <span className="flex items-center gap-2">
              <Underline className="size-4" aria-hidden />
              {t("rs.quietMarks")}
              <span className="font-normal text-muted">{t("rs.quietMarksHint")}</span>
            </span>
            {prefs.quietMarks ? <Check className="size-4 text-accent" aria-hidden /> : null}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
