/**
 * Small moments of feedback from the design system "Keep reading" (MotionTokens, SaveWord): a
 * highlighter sweep, a little burst, a "+1" that flies to an icon, a bump. Reading stays still;
 * these only run when the reader has just done something.
 *
 * Every helper checks `motionOff()` first and then does nothing, so only the end state shows: on the
 * e-ink theme, with "reduce motion", and on an engine without the Web Animations API (the Chrome 69
 * e-ink WebViews have `Element.animate`, older ones may not).
 */

export const DUR = { instant: 100, quick: 180, base: 280, slow: 420, celebrate: 900 } as const;
export const EASE = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  out: "cubic-bezier(0.16, 1, 0.3, 1)",
  in: "cubic-bezier(0.4, 0, 1, 1)",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

export function motionOff(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return true;
  if (document.documentElement.getAttribute("data-theme") === "eink") return true;
  if (typeof Element === "undefined" || typeof Element.prototype.animate !== "function") return true;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** A yellow highlighter stroke across a saved word in the page (`.book-sweep-save` in styles.css). */
export function sweepSave(word: Element | null | undefined): void {
  const ink = word?.querySelector<HTMLElement>(".book-tap") ?? (word instanceof HTMLElement ? word : null);
  if (!ink || motionOff()) return;
  ink.classList.remove("book-sweep-save");
  // Restart the animation when the same word is saved twice in a row.
  void ink.offsetWidth;
  ink.classList.add("book-sweep-save");
  window.setTimeout(() => ink.classList.remove("book-sweep-save"), DUR.slow + 60);
}

/** A short spring scale on an element: the heart when it is pressed, an icon that receives a "+1". */
export function bump(el: Element | null | undefined, scale = 1.2): void {
  if (!el || motionOff()) return;
  el.animate(
    [{ transform: "scale(1)" }, { transform: `scale(${scale})` }, { transform: "scale(1)" }],
    { duration: DUR.base, easing: EASE.spring },
  );
}

function center(el: Element): { x: number; y: number } {
  const box = el.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

function layer(): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:80;overflow:hidden";
  document.body.appendChild(host);
  return host;
}

/** Eight small dots out of an element (the heart when a word is saved), in brand and highlighter. */
export function burst(from: Element | null | undefined): void {
  if (!from || motionOff()) return;
  const { x, y } = center(from);
  const host = layer();
  const colours = ["var(--accent)", "var(--mark)"];
  const runs: Animation[] = [];
  for (let i = 0; i < 8; i += 1) {
    const dot = document.createElement("i");
    dot.style.cssText = `position:absolute;left:${x - 3}px;top:${y - 3}px;width:6px;height:6px;border-radius:9999px;background:${colours[i % 2]}`;
    host.appendChild(dot);
    const angle = (Math.PI * 2 * i) / 8 - Math.PI / 2;
    const reach = 22 + (i % 2) * 6;
    runs.push(
      dot.animate(
        [
          { transform: "translate(0, 0) scale(1)", opacity: 1 },
          { transform: `translate(${Math.cos(angle) * reach}px, ${Math.sin(angle) * reach}px) scale(0.4)`, opacity: 0 },
        ],
        { duration: DUR.slow, easing: EASE.out, fill: "forwards" },
      ),
    );
  }
  window.setTimeout(() => host.remove(), DUR.slow + 80);
  void runs;
}

/**
 * A "+1" that flies on an arc from one element to another (a saved word to the notebook icon), then
 * bumps the target. Nothing happens when either end is off screen.
 */
export function flyTo(from: Element | null | undefined, to: Element | null | undefined, text = "+1"): void {
  if (!from || !to || motionOff()) return;
  const start = center(from);
  const end = center(to);
  const target = to.getBoundingClientRect();
  if (target.width === 0 || target.bottom < 0 || target.top > window.innerHeight) return;
  const host = layer();
  const tag = document.createElement("b");
  tag.textContent = text;
  tag.style.cssText = `position:absolute;left:${start.x}px;top:${start.y}px;transform:translate(-50%,-50%);font:700 14px var(--font-sans);color:var(--accent-ink);background:var(--accent);border-radius:9999px;padding:2px 8px;line-height:18px`;
  host.appendChild(tag);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  // The middle frame is lifted, so the path is an arc rather than a straight line.
  const lift = Math.min(120, Math.abs(dx) / 2 + 40);
  const run = tag.animate(
    [
      { transform: "translate(-50%, -50%) scale(0.8)", opacity: 0 },
      { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.15 },
      { transform: `translate(calc(-50% + ${dx / 2}px), calc(-50% + ${dy / 2 - lift}px)) scale(1)`, opacity: 1, offset: 0.55 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.6)`, opacity: 0.2 },
    ],
    { duration: DUR.celebrate - 200, easing: EASE.standard, fill: "forwards" },
  );
  run.onfinish = () => {
    host.remove();
    bump(to, 1.18);
  };
  window.setTimeout(() => host.remove(), DUR.celebrate + 200);
}

/** Saving a word from the word card: the heart bumps and bursts, the word gets its highlighter, "+1" flies to the notebook. */
export function celebrateSave(parts: { heart?: Element | null; word?: Element | null; notebook?: Element | null }): void {
  bump(parts.heart, 1.25);
  burst(parts.heart);
  sweepSave(parts.word);
  flyTo(parts.word ?? parts.heart, parts.notebook);
}
