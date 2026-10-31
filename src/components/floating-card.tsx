import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { panConsumed, type PanBox } from "@/lib/sheet-pan";
import { anchorBox, anchorOffscreen, placeFloatingPanel } from "@/lib/floating-panel";
import { cn } from "@/components/ui";

/**
 * Tablets and desktops (Tailwind `md`, 768px and up): the card floats next to the tapped word.
 * Phones keep the bottom sheet. Tablets used to keep a fixed right-hand column, which held a
 * fifth of the screen empty while no card was open.
 */
export const DESKTOP_PANEL_QUERY = "(min-width: 768px)";

export function desktopPanel(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DESKTOP_PANEL_QUERY).matches
    : false;
}

const PANEL_WIDTH = 21 * 16;

type FloatState = { active: boolean; placed: boolean; style?: CSSProperties };

function sameBox(a: CSSProperties | undefined, b: CSSProperties): boolean {
  if (!a) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.maxHeight === b.maxHeight;
}

/**
 * On a wide screen, pin the card next to `anchor` and keep it there while the page scrolls.
 * When the anchor leaves the screen, call `onClose`. Narrow screens leave placement to CSS.
 */
export function useFloatingCard(
  anchor: HTMLElement | null,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  desktopWidth = PANEL_WIDTH,
): FloatState {
  const [active, setActive] = useState(desktopPanel);
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_PANEL_QUERY);
    const apply = () => setActive(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useLayoutEffect(() => {
    if (!active) {
      setStyle(undefined);
      return;
    }
    let frame = 0;
    const place = () => {
      frame = 0;
      const anchorEl = anchor;
      if (!anchorEl || !anchorEl.isConnected) return;
      if (anchorOffscreen(anchorEl)) {
        closeRef.current();
        return;
      }
      const panel = panelRef.current;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const width = Math.min(desktopWidth, Math.max(220, vw - 24));
      // The word body scrolls independently. Measure its unconstrained content so
      // expanding AND collapsing details can reposition and resize the outer card.
      const content = panel?.querySelector<HTMLElement>("[data-word-content]");
      let measured = panel ? Math.max(panel.offsetHeight, panel.scrollHeight) : 0;
      if (panel && content) {
        const css = getComputedStyle(panel);
        measured =
          parseFloat(css.paddingTop) +
          parseFloat(css.paddingBottom) +
          parseFloat(css.borderTopWidth) +
          parseFloat(css.borderBottomWidth);
        for (const child of panel.children) {
          if (!(child instanceof HTMLElement)) continue;
          const style = getComputedStyle(child);
          const height = child.hasAttribute("data-word-body")
            ? content.offsetHeight
            : child.offsetHeight;
          measured += height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
        }
      }
      const height = measured || 280;
      const placed = placeFloatingPanel({
        anchor: anchorBox(anchorEl),
        width,
        height,
        // offsetHeight rounds each section; leave two pixels for fractional font metrics.
        minHeight: content
          ? Math.ceil(measured - content.offsetHeight + Math.min(80, content.offsetHeight)) + 2
          : undefined,
        viewportWidth: vw,
        viewportHeight: vh,
      });
      // The card grows out of the tapped word (design system TapWord): its scale origin is the
      // word's centre, in the card's own coordinates.
      const word = anchorEl.getBoundingClientRect();
      const next: CSSProperties = {
        top: Math.round(placed.top),
        left: Math.round(placed.left),
        right: "auto",
        bottom: "auto",
        width: Math.round(placed.width),
        maxHeight: Math.round(placed.maxHeight),
        transformOrigin: `${Math.round(word.left + word.width / 2 - placed.left)}px ${Math.round(word.top + word.height / 2 - placed.top)}px`,
      };
      setStyle((prev) => (sameBox(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    const observer = new ResizeObserver(schedule);
    const article = anchor?.closest("article");
    if (article) observer.observe(article);
    observer.observe(document.documentElement);
    const panel = panelRef.current;
    if (panel) {
      observer.observe(panel);
      for (const part of panel.querySelectorAll(
        "[data-word-header], [data-word-content], [data-word-footer]",
      )) {
        observer.observe(part);
      }
      panel.addEventListener("toggle", schedule, true);
    }
    return () => {
      panel?.removeEventListener("toggle", schedule, true);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active, anchor, panelRef, desktopWidth]);

  return { active, placed: Boolean(style), style: active ? style : undefined };
}

function focusable(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, summary"),
  ].filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.tabIndex !== -1 &&
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== "hidden",
  );
}

/** Move focus into the card, keep Tab inside it, and return focus to the anchor when it closes. */
function usePanelFocus(
  active: boolean,
  panelRef: RefObject<HTMLElement | null>,
  anchor: HTMLElement | null,
) {
  useEffect(() => {
    if (!active) return;
    const panel = panelRef.current;
    if (!panel) return;
    // The card stays hidden until it has a position. Focusing it earlier does nothing.
    if (getComputedStyle(panel).visibility === "hidden") return;
    // Focus the card so Tab stays inside it, but do not ask for a focus ring.
    // The ring is drawn outside the rounded border and looks like a second frame.
    panel.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable(panel);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const current = document.activeElement;
      if (event.shiftKey && (current === first || current === panel)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    panel.addEventListener("keydown", onKey);
    return () => {
      panel.removeEventListener("keydown", onKey);
      // Word cards restore only on an explicit close, never on resize or click-away.
      if (anchor?.isConnected && !anchor.hasAttribute("data-word"))
        anchor.focus({ preventScroll: true });
    };
  }, [active, anchor, panelRef]);
}

/** Phone bottom sheet only. Tablets keep the side column; wide screens float. */
const PHONE_SHEET = "(max-width: 47.99rem)";

export function phoneSheet(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(PHONE_SHEET).matches
    : false;
}

/**
 * Pull the phone sheet down from noninteractive content at its scroll top to close it.
 * A gesture that starts scrolled belongs to the content until the finger lifts.
 * Touch and mouse are handled apart, so a phone tap is not also read as a mouse drag.
 */
/** The boxes from `node` up to `root`, for panConsumed. */
function panBoxes(node: Element | null, root: HTMLElement): PanBox[] {
  const boxes: PanBox[] = [];
  let at: Element | null = node;
  while (at && root.contains(at)) {
    const style = window.getComputedStyle(at);
    boxes.push({
      scrolls: /(auto|scroll)/.test(style.overflowY) || at instanceof HTMLTextAreaElement,
      scrollTop: at.scrollTop,
      scrollHeight: at.scrollHeight,
      clientHeight: at.clientHeight,
    });
    if (at === root) break;
    at = at.parentElement;
  }
  return boxes;
}

/** Back to place on the soft spring (with reduced motion or on e-ink it just goes). */
const SPRING = "transform var(--dur-spring, 600ms) var(--ease-spring-soft, ease-out)";
function springBack(): string {
  const still =
    (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
    document.documentElement.getAttribute("data-theme") === "eink";
  return still ? "none" : SPRING;
}

/**
 * Where the sheet sits for a pull of `dy` px (design system SpringSheet): with the finger going
 * down; going up, a rubber band, (1 - 1 / (d * 0.55 / h + 1)) * h, tighter the further it goes.
 */
export function sheetOffset(dy: number, height: number): number {
  if (dy >= 0) return dy;
  const h = Math.max(1, height);
  return -(1 - 1 / ((-dy * 0.55) / h + 1)) * h;
}

/** Let go: close past a third of the sheet's height, or on a downward flick faster than 0.6 px/ms. */
export function sheetCloses(dy: number, speed: number, height: number): boolean {
  return dy > Math.max(1, height) / 3 || (dy > 12 && speed > 0.6);
}

/**
 * Drag a bottom sheet with the finger (design system SpringSheet): down to close it, back on the
 * spring when let go short of that. `media` is when the panel is a bottom sheet at all.
 */
export function useSheetDrag(panelRef: RefObject<HTMLElement | null>, onClose: () => void, media = PHONE_SHEET, open = true) {
  usePhoneSheetDismiss(panelRef, onClose, media, open);
}

function usePhoneSheetDismiss(panelRef: RefObject<HTMLElement | null>, onClose: () => void, media = PHONE_SHEET, open = true) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const query = window.matchMedia(media);
    let detach = () => {};
    const bind = () => {
      detach();
      detach = () => {};
      const el = panelRef.current;
      if (!query.matches || !el) return;
      let startY = 0;
      let startX = 0;
      let lastY = 0;
      // The finger's speed at release (px/ms), from the last moves (design system SpringSheet).
      let lastT = 0;
      let speed = 0;
      let mode: "idle" | "undecided" | "dismiss" | "scroll" = "idle";
      let timer = 0;
      let ignoreMouseUntil = 0;
      let suppressClick = false;
      let stopMouse = () => {};
      const clearTimer = () => {
        if (timer) window.clearTimeout(timer);
        timer = 0;
      };
      const begin = (x: number, y: number, target: EventTarget | null) => {
        clearTimer();
        // Only suppress the drag's trailing click, never a new deliberate press.
        suppressClick = false;
        const origin = target instanceof Element ? target : null;
        const selection = window.getSelection();
        if (
          el.hasAttribute("data-word-card") &&
          selection &&
          !selection.isCollapsed &&
          selection.anchorNode &&
          el.contains(selection.anchorNode)
        ) {
          mode = "idle";
          return;
        }
        // Actions are taps, not drag handles. A gesture that starts in scrolled
        // content belongs to that scroller even if it reaches the top midway.
        if (
          origin?.closest(
            'a, button, input, textarea, select, summary, [role="button"], [data-word-footer]',
          )
        ) {
          mode = "idle";
          return;
        }
        let node = origin;
        while (node && el.contains(node)) {
          if (node.scrollTop > 0) {
            mode = "scroll";
            return;
          }
          if (node === el) break;
          node = node.parentElement;
        }
        startX = x;
        startY = y;
        lastY = y;
        lastT = Date.now();
        speed = 0;
        mode = "undecided";
      };
      const move = (x: number, y: number, event: Event) => {
        if (mode === "idle" || mode === "scroll") return;
        const dy = y - startY;
        const dx = x - startX;
        const now = Date.now();
        if (now > lastT) speed = speed * 0.4 + ((y - lastY) / (now - lastT)) * 0.6;
        lastT = now;
        lastY = y;
        if (mode === "undecided") {
          const pull = dy > 0 && Math.abs(dy) > Math.abs(dx);
          // A downward pull at the top belongs to the sheet. Claim it on the first pixels:
          // once the browser starts panning the content (or the page under it), touchmove is
          // no longer cancelable and the article scrolls instead of the sheet following the
          // finger. The 8px threshold below still decides when the sheet starts to move.
          if (pull && el.scrollTop <= 0 && Math.abs(dy) < 8) {
            event.preventDefault();
            return;
          }
          if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
          if (pull && el.scrollTop <= 0 && dy > 0) {
            mode = "dismiss";
            el.style.animation = "none";
            el.style.transition = "none";
          } else {
            mode = "scroll";
            return;
          }
        }
        // Once native scrolling owns a touch, never move the sheet on top of it.
        if (event.type === "touchmove" && !event.cancelable) {
          mode = "scroll";
          el.style.transform = "";
          return;
        }
        event.preventDefault();
        // The sheet goes with the finger; above its place it pulls back harder the further it goes.
        el.style.transform = `translateY(${sheetOffset(dy, el.offsetHeight)}px)`;
      };
      const end = () => {
        if (mode !== "dismiss") {
          mode = "idle";
          return;
        }
        const dy = lastY - startY;
        mode = "idle";
        suppressClick = true;
        if (sheetCloses(dy, speed, el.offsetHeight)) {
          // Carry on from where the finger let go, at about its speed.
          el.style.transition = `transform ${Math.round(Math.max(120, Math.min(260, (el.offsetHeight - dy) / Math.max(speed, 1))))}ms ease-out`;
          el.style.transform = "translateY(110%)";
          timer = window.setTimeout(() => closeRef.current(), 160);
        } else {
          el.style.transition = springBack();
          el.style.transform = "";
        }
      };
      const cancel = () => {
        clearTimer();
        mode = "idle";
        el.style.transition = springBack();
        el.style.transform = "";
      };
      // The pan guard: every move over the sheet that nothing inside it can scroll is cancelled,
      // whatever the gesture is (a pull, a swipe on a button, a box that reached its end).
      let guardY = 0;
      let guardFrom: Element | null = null;
      const onTouchStart = (event: TouchEvent) => {
        if (event.touches.length !== 1) {
          cancel();
          return;
        }
        const touch = event.touches[0];
        if (!touch) return;
        ignoreMouseUntil = Date.now() + 700;
        guardY = touch.clientY;
        guardFrom = event.target instanceof Element ? event.target : null;
        begin(touch.clientX, touch.clientY, event.target);
      };
      const onTouchMove = (event: TouchEvent) => {
        const touch = event.touches[0];
        if (event.touches.length !== 1 || !touch) {
          // Two fingers on the sheet: never zoom or move the page behind it either.
          if (event.cancelable) event.preventDefault();
          cancel();
          return;
        }
        move(touch.clientX, touch.clientY, event);
        const dy = touch.clientY - guardY;
        guardY = touch.clientY;
        if (event.defaultPrevented || !event.cancelable) return;
        if (!panConsumed(panBoxes(guardFrom, el), dy)) event.preventDefault();
      };
      const onClick = (event: MouseEvent) => {
        if (!suppressClick) return;
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
      };
      const onMouseDown = (event: MouseEvent) => {
        if (event.button !== 0 || Date.now() < ignoreMouseUntil) return;
        begin(event.clientX, event.clientY, event.target);
        stopMouse();
        const onMouseMove = (moveEvent: MouseEvent) =>
          move(moveEvent.clientX, moveEvent.clientY, moveEvent);
        const onMouseUp = () => {
          stopMouse();
          end();
        };
        stopMouse = () => {
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
        };
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      };
      el.addEventListener("touchstart", onTouchStart, { passive: true });
      el.addEventListener("touchmove", onTouchMove, { passive: false });
      el.addEventListener("touchend", end);
      el.addEventListener("touchcancel", cancel);
      el.addEventListener("mousedown", onMouseDown);
      el.addEventListener("click", onClick, true);
      detach = () => {
        clearTimer();
        stopMouse();
        el.removeEventListener("touchstart", onTouchStart);
        el.removeEventListener("touchmove", onTouchMove);
        el.removeEventListener("touchend", end);
        el.removeEventListener("touchcancel", cancel);
        el.removeEventListener("mousedown", onMouseDown);
        el.removeEventListener("click", onClick, true);
        el.style.transform = "";
        el.style.transition = "";
      };
    };
    bind();
    query.addEventListener("change", bind);
    return () => {
      query.removeEventListener("change", bind);
      detach();
    };
  }, [panelRef, media, open]);
}

/**
 * The word card and the paragraph card. On a tablet or a wide screen this floats next to the anchor.
 * On a phone it is the bottom sheet.
 */
export function FloatingAside({
  anchor,
  onClose,
  label,
  kind,
  desktopWidth,
  className,
  children,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  label: string;
  kind: "word" | "para";
  desktopWidth?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const float = useFloatingCard(anchor, ref, onClose, desktopWidth);
  usePanelFocus(float.active && float.placed, ref, anchor);
  usePhoneSheetDismiss(ref, onClose);
  return (
    <aside
      ref={ref}
      aria-label={label}
      tabIndex={float.active ? -1 : undefined}
      role={float.active ? "dialog" : undefined}
      aria-modal={float.active ? false : undefined}
      data-word-card={kind === "word" ? true : undefined}
      data-para-panel={kind === "para" ? true : undefined}
      data-float={float.active ? "" : undefined}
      data-placed={float.placed ? "" : undefined}
      style={float.style}
      className={cn(className, !float.active && "anim-sheet")}
    >
      {children}
    </aside>
  );
}
