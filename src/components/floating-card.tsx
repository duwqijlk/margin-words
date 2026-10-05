import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { anchorBox, anchorOffscreen, placeFloatingPanel } from "@/lib/floating-panel";
import { cn } from "@/components/ui";

/** Matches the `lg` screen in the style sheet: wide web desktop. Phones and tablets stay as they are. */
export const DESKTOP_PANEL_QUERY = "(min-width: 1024px)";

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
      const width = Math.min(PANEL_WIDTH, Math.max(220, vw - 24));
      // scrollHeight keeps the full content after max-height clamps the box, so a later
      // pass can still move a growing card (a sentence note, for example) to a taller side.
      const measured = panel ? Math.max(panel.offsetHeight, panel.scrollHeight) : 0;
      const height = measured || 280;
      const placed = placeFloatingPanel({
        anchor: anchorBox(anchorEl),
        width,
        height,
        viewportWidth: vw,
        viewportHeight: vh,
      });
      const next: CSSProperties = {
        top: Math.round(placed.top),
        left: Math.round(placed.left),
        right: "auto",
        bottom: "auto",
        width: Math.round(placed.width),
        maxHeight: Math.round(placed.maxHeight),
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
    if (panelRef.current) observer.observe(panelRef.current);
    return () => {
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active, anchor, panelRef]);

  return { active, placed: Boolean(style), style: active ? style : undefined };
}

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, [href], input, select, textarea")].filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
  );
}

/** Move focus into the card, keep Tab inside it, and return focus to the anchor when it closes. */
function usePanelFocus(active: boolean, panelRef: RefObject<HTMLElement | null>, anchor: HTMLElement | null) {
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
      if (anchor?.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [active, anchor, panelRef]);
}

/** Phone bottom sheet only. Tablets keep the side column; wide screens float. */
const PHONE_SHEET = "(max-width: 47.99rem)";

/**
 * Pull the phone sheet down to close it. A downward drag closes only when the sheet
 * is already at the top of its scroll, so a long note still scrolls first.
 * Touch and mouse are handled apart, so a phone tap is not also read as a mouse drag.
 */
function usePhoneSheetDismiss(panelRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const query = window.matchMedia(PHONE_SHEET);
    let detach = () => {};
    const bind = () => {
      detach();
      detach = () => {};
      const el = panelRef.current;
      if (!query.matches || !el) return;
      let startY = 0;
      let startX = 0;
      let lastY = 0;
      let mode: "idle" | "undecided" | "dismiss" | "scroll" = "idle";
      let timer = 0;
      let ignoreMouseUntil = 0;
      let suppressClick = false;
      let stopMouse = () => {};
      const clearTimer = () => {
        if (timer) window.clearTimeout(timer);
        timer = 0;
      };
      const begin = (x: number, y: number) => {
        clearTimer();
        startX = x;
        startY = y;
        lastY = y;
        mode = "undecided";
      };
      const move = (x: number, y: number, event: Event) => {
        if (mode === "idle" || mode === "scroll") return;
        const dy = y - startY;
        const dx = x - startX;
        lastY = y;
        if (mode === "undecided") {
          if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
          if (dy > 0 && Math.abs(dy) > Math.abs(dx) && el.scrollTop <= 0) {
            mode = "dismiss";
            el.style.animation = "none";
            el.style.transition = "none";
          } else {
            mode = "scroll";
            return;
          }
        }
        event.preventDefault();
        el.style.transform = `translateY(${Math.max(0, dy)}px)`;
      };
      const end = () => {
        if (mode !== "dismiss") {
          mode = "idle";
          return;
        }
        const dy = lastY - startY;
        mode = "idle";
        if (dy < 8) return;
        suppressClick = true;
        el.style.transition = "transform 0.18s ease-out";
        if (dy > 72) {
          el.style.transform = "translateY(110%)";
          timer = window.setTimeout(() => closeRef.current(), 160);
        } else {
          el.style.transform = "";
        }
      };
      const onTouchStart = (event: TouchEvent) => {
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        if (!touch) return;
        ignoreMouseUntil = Date.now() + 700;
        begin(touch.clientX, touch.clientY);
      };
      const onTouchMove = (event: TouchEvent) => {
        const touch = event.touches[0];
        if (!touch) return;
        move(touch.clientX, touch.clientY, event);
      };
      const onClick = (event: MouseEvent) => {
        if (!suppressClick) return;
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
      };
      const onMouseDown = (event: MouseEvent) => {
        if (event.button !== 0 || Date.now() < ignoreMouseUntil) return;
        begin(event.clientX, event.clientY);
        stopMouse();
        const onMouseMove = (moveEvent: MouseEvent) => move(moveEvent.clientX, moveEvent.clientY, moveEvent);
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
      el.addEventListener("touchcancel", end);
      el.addEventListener("mousedown", onMouseDown);
      el.addEventListener("click", onClick, true);
      detach = () => {
        clearTimer();
        stopMouse();
        el.removeEventListener("touchstart", onTouchStart);
        el.removeEventListener("touchmove", onTouchMove);
        el.removeEventListener("touchend", end);
        el.removeEventListener("touchcancel", end);
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
  }, [panelRef]);
}

/**
 * The word card and the paragraph card. On a wide screen this floats next to the anchor.
 * On a phone it is the bottom sheet. On a tablet it is the right-hand column.
 */
export function FloatingAside({
  anchor,
  onClose,
  label,
  kind,
  className,
  children,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  label: string;
  kind: "word" | "para";
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const float = useFloatingCard(anchor, ref, onClose);
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
