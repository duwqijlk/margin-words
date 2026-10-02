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
      const height = panel?.offsetHeight || 280;
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
    panel.focus({ preventScroll: true });
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
