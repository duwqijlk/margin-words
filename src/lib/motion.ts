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
  // Four sides rather than `inset`, which Chrome 69 (the e-ink readers) does not know.
  host.style.cssText = "position:fixed;top:0;right:0;bottom:0;left:0;pointer-events:none;z-index:80;overflow:hidden";
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

/* ---- Covers (design system BookOpen) */

let lastCover: HTMLElement | null = null;
let tiltInstalled = false;

/**
 * Covers inside `[data-tilt]` lean towards the pointer (at most 6°, lifted 4px) with a soft sheen
 * that follows it. Only with a mouse or pen on a device that can hover; never on touch, e-ink or with
 * reduced motion. One listener for the whole page, installed once.
 */
export function installCoverTilt(): void {
  if (tiltInstalled || typeof document === "undefined") return;
  tiltInstalled = true;
  let current: HTMLElement | null = null;
  const reset = () => {
    if (!current) return;
    current.style.transform = "";
    current.removeAttribute("data-tilting");
    current = null;
  };
  document.addEventListener("pointerdown", (event) => {
    const host = (event.target as Element | null)?.closest?.("[data-tilt]");
    lastCover = host?.querySelector<HTMLElement>(".cover-frame") ?? null;
  }, true);
  document.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" || motionOff()) return reset();
    const host = (event.target as Element | null)?.closest?.("[data-tilt]");
    const frame = host?.querySelector<HTMLElement>(".cover-frame") ?? null;
    if (frame !== current) reset();
    if (!frame) return;
    current = frame;
    const box = frame.getBoundingClientRect();
    const x = Math.max(-0.5, Math.min(0.5, (event.clientX - box.left) / box.width - 0.5));
    const y = Math.max(-0.5, Math.min(0.5, (event.clientY - box.top) / box.height - 0.5));
    frame.setAttribute("data-tilting", "");
    frame.style.transform = `perspective(700px) rotateY(${(x * 12).toFixed(2)}deg) rotateX(${(-y * 12).toFixed(2)}deg) translateY(-4px)`;
    frame.style.setProperty("--sx", `${((x + 0.5) * 100).toFixed(1)}%`);
    frame.style.setProperty("--sy", `${((y + 0.5) * 100).toFixed(1)}%`);
  }, { passive: true });
  document.addEventListener("pointerleave", reset, true);
}

type TransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown };

/**
 * Opening a book from its cover: the cover grows into the page (a View Transition, Chrome 111+).
 * Elsewhere, and on e-ink or with reduced motion, the page just changes.
 */
export function openFromCover(update: () => void): void {
  const doc = document as TransitionDocument;
  const cover = lastCover;
  lastCover = null;
  if (!cover || !cover.isConnected || typeof doc.startViewTransition !== "function" || motionOff()) {
    update();
    return;
  }
  cover.style.setProperty("view-transition-name", "book-cover");
  doc.startViewTransition(() => {
    cover.style.removeProperty("view-transition-name");
    update();
  });
}

/* ---- Review (design system ReviewFlip, RoundComplete) */

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Resolves when an animation ends. `Animation.finished` needs Chrome 84, so this uses `onfinish`, with a timer as a backstop. */
function ended(run: Animation, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    run.onfinish = finish;
    run.oncancel = finish;
    window.setTimeout(finish, ms + 120);
  });
}

/** A short side-to-side shake: "not yet", never a punishment (no red flash). */
export function shake(el: Element | null | undefined): Promise<void> {
  if (!el || motionOff()) return Promise.resolve();
  const run = el.animate(
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-8px)", offset: 0.2 },
      { transform: "translateX(7px)", offset: 0.45 },
      { transform: "translateX(-4px)", offset: 0.7 },
      { transform: "translateX(0)" },
    ],
    { duration: DUR.base, easing: EASE.standard },
  );
  return ended(run, DUR.base);
}

/** The card leaves to one side (right = known, left = not yet); the next one rises in by CSS. */
export function slideOut(el: Element | null | undefined, side: "left" | "right"): Promise<void> {
  if (!el || motionOff()) return Promise.resolve();
  const run = el.animate(
    [
      { transform: "translateX(0)", opacity: 1 },
      { transform: `translateX(${side === "right" ? 48 : -48}px)`, opacity: 0 },
    ],
    { duration: DUR.base, easing: EASE.in, fill: "forwards" },
  );
  return ended(run, DUR.base);
}

/** Wait while the check stamp lands (it is drawn by CSS); nothing to wait for when motion is off. */
export function stampPause(): Promise<void> {
  return motionOff() ? Promise.resolve() : wait(DUR.base);
}

/**
 * Counts a number up from 0 in `DUR.celebrate`, writing it into `el`. With motion off the final
 * number is written at once. Returns a stop function.
 */
export function countUp(el: HTMLElement | null | undefined, to: number, done?: () => void): () => void {
  if (!el) return () => undefined;
  if (motionOff() || to <= 0) {
    el.textContent = String(to);
    done?.();
    return () => undefined;
  }
  let frame = 0;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / DUR.celebrate);
    // ease-out cubic
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = String(Math.round(to * eased));
    if (t < 1) frame = requestAnimationFrame(step);
    else done?.();
  };
  el.textContent = "0";
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

/**
 * One fall of confetti (about 36 pieces in brand, highlighter, ink and pale green) over the top of
 * the screen, gone within `DUR.celebrate`. Only for the end of a review round, the one big moment.
 */
export function confetti(from: Element | null | undefined, pieces = 36): void {
  if (!from || motionOff()) return;
  const box = from.getBoundingClientRect();
  const host = layer();
  const colours = ["var(--accent)", "var(--mark)", "var(--ink)", "rgb(var(--accent-rgb) / 0.35)"];
  for (let i = 0; i < pieces; i += 1) {
    const bit = document.createElement("i");
    const w = 6 + (i % 3) * 2;
    const h = i % 2 ? 10 : 6;
    const x = box.left + box.width * (0.15 + 0.7 * Math.random());
    const y = box.top + Math.min(40, box.height / 3);
    bit.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:1px;background:${colours[i % colours.length]}`;
    host.appendChild(bit);
    const dx = (Math.random() - 0.5) * 320;
    const rise = 60 + Math.random() * 90;
    const fall = 180 + Math.random() * 200;
    const spin = (Math.random() - 0.5) * 720;
    bit.animate(
      [
        { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${-rise}px) rotate(${spin * 0.4}deg)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${dx}px, ${fall}px) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: DUR.celebrate - 100 + Math.random() * 100, easing: EASE.out, fill: "forwards", delay: Math.random() * 80 },
    );
  }
  window.setTimeout(() => host.remove(), DUR.celebrate + 300);
}

/** The Shelf tab that is on screen: the phone tab bar, or the top navigation. */
export function shelfTabTarget(): Element | null {
  for (const el of document.querySelectorAll('[data-nav="shelf"]')) {
    const box = el.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return el;
  }
  return null;
}
