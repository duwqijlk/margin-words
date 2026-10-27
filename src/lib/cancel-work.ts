/** Chrome 69 has AbortController; missing engines still render and cancel logically. */
export function cancellation() {
  const controller = typeof AbortController === "function" ? new AbortController() : undefined;
  let aborted = false;
  return {
    signal: controller?.signal,
    get aborted() { return aborted || Boolean(controller?.signal.aborted); },
    abort() { aborted = true; controller?.abort(); },
  };
}
export function abortError(): Error {
  const error = new Error("Operation cancelled");
  error.name = "AbortError";
  return error;
}
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}
/** Bound waiting even when a stream ignores abort. No AbortSignal.timeout API. */
export function requestScope(parent?: AbortSignal, deadline = 30000) {
  const controller = cancellation();
  let rejectWait: ((error: Error) => void) | undefined;
  const stopped = new Promise<never>((_, reject) => { rejectWait = reject; });
  void stopped.catch(() => undefined);
  const stop = () => { controller.abort(); rejectWait?.(abortError()); };
  const timer = setTimeout(stop, deadline);
  parent?.addEventListener("abort", stop);
  if (parent?.aborted) stop();
  return {
    signal: controller.signal,
    run<T>(work: Promise<T>): Promise<T> { return Promise.race([work, stopped]); },
    dispose() { clearTimeout(timer); parent?.removeEventListener("abort", stop); },
  };
}

/** Blob.arrayBuffer arrived after Chrome 69; FileReader also supports generated private-library Files. */
export async function readBlobBuffer(blob: Blob, signal?: AbortSignal): Promise<ArrayBuffer> {
  checkAbort(signal);
  if (typeof blob.arrayBuffer === "function") {
    const value = await blob.arrayBuffer();
    checkAbort(signal);
    return value;
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const stop = () => { reader.abort(); reject(abortError()); };
    const cleanup = () => { signal?.removeEventListener("abort", stop); };
    reader.onload = () => { cleanup(); resolve(reader.result as ArrayBuffer); };
    reader.onerror = () => { cleanup(); reject(reader.error ?? new Error("Could not read file")); };
    reader.onabort = () => { cleanup(); reject(abortError()); };
    signal?.addEventListener("abort", stop);
    reader.readAsArrayBuffer(blob);
  });
}
