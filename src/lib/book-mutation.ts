/** Epochs distinguish even a deleted/recreated card with the same id. */
export type TargetMutation = { bookId: string; generation: number };
const generations = new Map<string, number>();
const tails = new Map<string, Promise<unknown>>();
export function captureTarget(bookId: string): TargetMutation {
  return { bookId, generation: generations.get(bookId) ?? 0 };
}
export function targetIsCurrent(target: TargetMutation): boolean {
  return (generations.get(target.bookId) ?? 0) === target.generation;
}
export function invalidateTarget(bookId: string): void {
  generations.set(bookId, (generations.get(bookId) ?? 0) + 1);
}
export function queueBookMutation<T>(bookId: string, action: () => Promise<T>): Promise<T> {
  const run = (tails.get(bookId) ?? Promise.resolve()).then(action);
  const tail = run.catch(() => undefined);
  tails.set(bookId, tail);
  void tail.then(() => { if (tails.get(bookId) === tail) tails.delete(bookId); });
  return run;
}
