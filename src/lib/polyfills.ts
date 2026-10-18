/**
 * Polyfills for older WebView engines (e.g. Android 8.1 on Chrome 69 e-ink readers).
 *
 * Browsers older than Chrome 73/80/85 lack methods like `Object.fromEntries`,
 * `Promise.allSettled`, `String.prototype.matchAll`, `Array.prototype.flat`,
 * `Array.prototype.flatMap`, and `ResizeObserver`.
 *
 * Without these polyfills, any call to them throws an uncaught TypeError that triggers
 * the root ErrorBoundary ("This page did not load").
 */

// 1. Array.prototype.flat / flatMap (Chrome 69+)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const arrProto = Array.prototype as any;
if (!arrProto.flat) {
  arrProto.flat = function (depth: number = 1): unknown[] {
    const d = Math.floor(depth);
    if (d < 1) return Array.prototype.slice.call(this);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flatten = (arr: any[], curDepth: number): any[] => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return arr.reduce((acc: any[], val: any) => {
        if (Array.isArray(val) && curDepth > 0) {
          acc.push(...flatten(val, curDepth - 1));
        } else {
          acc.push(val);
        }
        return acc;
      }, []);
    };
    return flatten(Array.from(this as ArrayLike<unknown>), d);
  };
}

if (!arrProto.flatMap) {
  arrProto.flatMap = function (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (value: any, index: number, array: any[]) => any,
    thisArg?: unknown,
  ): unknown[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any[]).map(callback, thisArg).flat(1);
  };
}

// 2. Object.fromEntries (Chrome 73)
if (typeof Object.fromEntries !== "function") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Object.fromEntries = function <T = any>(entries: Iterable<readonly [PropertyKey, T]>): { [k: string]: T } {
    const obj: Record<string, T> = {};
    for (const [key, val] of entries) {
      obj[String(key)] = val;
    }
    return obj;
  };
}

// 3. Promise.allSettled (Chrome 76)
if (typeof Promise.allSettled !== "function") {
  Promise.allSettled = function <T>(
    promises: Iterable<T | PromiseLike<T>>,
  ): Promise<Array<PromiseSettledResult<Awaited<T>>>> {
    return Promise.all(
      Array.from(promises).map((p) =>
        Promise.resolve(p).then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason) => ({ status: "rejected" as const, reason }),
        ),
      ),
    );
  };
}

// 4. String.prototype.matchAll (Chrome 73)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const strProto = String.prototype as any;
if (!strProto.matchAll) {
  strProto.matchAll = function* (regexp: RegExp): Generator<RegExpExecArray, void, undefined> {
    const flags = regexp.flags.includes("g") ? regexp.flags : regexp.flags + "g";
    const rx = new RegExp(regexp.source, flags);
    rx.lastIndex = regexp.lastIndex;
    const str = String(this);
    let match: RegExpExecArray | null;
    while ((match = rx.exec(str)) !== null) {
      yield match;
      if (rx.lastIndex === match.index) {
        rx.lastIndex += 1;
      }
    }
  };
}

// 5. MediaQueryList addListener fallback (Safari 13 / older WebViews)
if (typeof window !== "undefined" && window.MediaQueryList) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mqlProto = window.MediaQueryList.prototype as any;
  if (!mqlProto.addEventListener && typeof mqlProto.addListener === "function") {
    mqlProto.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject) {
      if (type === "change" && typeof listener === "function") {
        this.addListener(listener);
      }
    };
    mqlProto.removeEventListener = function (type: string, listener: EventListenerOrEventListenerObject) {
      if (type === "change" && typeof listener === "function") {
        this.removeListener(listener);
      }
    };
  }
}

// 6. ResizeObserver safe fallback (Chrome 64 / older WebViews)
if (typeof window !== "undefined" && typeof (window as unknown as { ResizeObserver?: unknown }).ResizeObserver !== "function") {
  class ResizeObserverPolyfill {
    private callback: ResizeObserverCallback;
    private timer: number = 0;
    private targets: Set<Element> = new Set();
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.targets.add(target);
      if (!this.timer) {
        this.timer = window.setInterval(() => {
          if (this.targets.size === 0) return;
          const entries: ResizeObserverEntry[] = Array.from(this.targets).map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              target: el,
              contentRect: rect,
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            };
          });
          this.callback(entries, this as unknown as ResizeObserver);
        }, 1000);
      }
    }
    unobserve(target: Element) {
      this.targets.delete(target);
      if (this.targets.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = 0;
      }
    }
    disconnect() {
      this.targets.clear();
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = 0;
      }
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).ResizeObserver = ResizeObserverPolyfill;
}
