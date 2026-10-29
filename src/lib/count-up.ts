import { useEffect, useRef, useState } from "react";
import { DUR, motionOff } from "@/lib/motion";

/**
 * A number that counts from 0 (or from where it was) up to `value` in `DUR.celebrate`, easing out
 * (design system LibraryStats: the big numbers roll in). `delay` staggers a row of them. With motion
 * off (e-ink, reduced motion) the value shows at once. `done` turns true once it has landed, for the
 * highlighter drawn under it.
 */
export function useCountUp(value: number, delay = 0): { shown: number; done: boolean } {
  const still = motionOff();
  const [shown, setShown] = useState(() => (still ? value : 0));
  const [done, setDone] = useState(still);
  const from = useRef(still ? value : 0);
  useEffect(() => {
    if (motionOff() || typeof requestAnimationFrame !== "function") {
      setShown(value);
      from.current = value;
      setDone(true);
      return;
    }
    setDone(false);
    let frame = 0;
    const begin = from.current;
    const timer = window.setTimeout(() => {
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / DUR.celebrate);
        const eased = 1 - Math.pow(1 - t, 3);
        const next = Math.round(begin + (value - begin) * eased);
        setShown(next);
        from.current = next;
        if (t < 1) frame = requestAnimationFrame(step);
        else setDone(true);
      };
      frame = requestAnimationFrame(step);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [value, delay]);
  return { shown, done };
}
