import { cancellation } from "@/lib/cancel-work";
import { EDITION_MATCH_OK, type EditionMatch } from "@/lib/edition-match";

export type OwnEpubPhase = "idle" | "checking" | "downloading" | "confirm" | "preparing" | "saving" | "error" | "done";
type Match = Pick<EditionMatch, "kind" | "rate">;

/** Use the raw rate: a displayed 80% can still be a 79.6% match. */
export function needsPairConfirmation(match: Match): boolean {
  return match.kind === "none" || !(match.rate >= EDITION_MATCH_OK);
}

export type OwnEpubState<Preview> = {
  phase: OwnEpubPhase;
  preview: Preview | null;
  error: unknown;
};

export type PairingWork = {
  signal?: AbortSignal;
  current: () => boolean;
  check: () => void;
  checking: () => void;
  writing: () => void;
};

/** One dialog lifetime. The synchronous lock also covers the render before disabled controls paint. */
export function createOwnEpubFlow<Preview extends { match: Match }, Saved>(actions: {
  change: (state: OwnEpubState<Preview>) => void;
  hasTarget: () => boolean;
  prepareSave?: boolean;
  targetMissing: () => Error;
  save: (preview: Preview, work: PairingWork) => Promise<Saved>;
  register: (saved: Saved, preview: Preview) => void;
  saved: (saved: Saved, preview: Preview) => void;
}) {
  let state: OwnEpubState<Preview> = { phase: "idle", preview: null, error: null };
  let active: ReturnType<typeof cancellation> | null = null;
  let closed = false;
  let installed: { preview: Preview; result: Saved } | null = null;

  function publish(next: OwnEpubState<Preview>) {
    state = next;
    actions.change(state);
  }

  function current(controller: ReturnType<typeof cancellation>) {
    return active === controller && !controller.aborted;
  }

  async function commit(controller: ReturnType<typeof cancellation>, preview: Preview) {
    if (!current(controller)) return;
    if (!actions.hasTarget()) throw actions.targetMissing();
    publish({ phase: actions.prepareSave && installed?.preview !== preview ? "preparing" : "saving", preview, error: null });
    // If registration failed after storage succeeded, retry registration, not the storage write.
    const result = installed?.preview === preview ? installed.result : await actions.save(preview, workFor(controller));
    if (!current(controller)) return;
    installed = { preview, result };
    if (!actions.hasTarget()) throw actions.targetMissing();
    actions.register(result, preview);
    publish({ phase: "done", preview, error: null });
    actions.saved(result, preview);
  }

  async function run(controller: ReturnType<typeof cancellation>, task: () => Promise<void>) {
    try {
      await task();
    } catch (error) {
      if (current(controller) && state.phase !== "done") publish({ ...state, phase: "error", error });
    } finally {
      if (active === controller) active = null;
    }
  }

  function workFor(controller: ReturnType<typeof cancellation>): PairingWork {
    return {
        signal: controller.signal,
        current: () => current(controller),
        check: () => {
          // Internal cancellation never reaches the UI: run discards obsolete errors.
          if (!current(controller)) throw new Error("Pairing cancelled");
        },
        writing: () => {
          if (!current(controller)) throw new Error("Pairing cancelled");
          publish({ ...state, phase: "saving" });
        },
        checking: () => {
          if (current(controller)) publish({ ...state, phase: "checking" });
        },
    };
  }

  return {
    getState: () => state,
    // React's development effect replay reconnects the same, otherwise one-shot, lifetime.
    open() { closed = false; },
    async start(load: (work: PairingWork) => Promise<Preview>, phase: "checking" | "downloading") {
      if (closed || active || state.phase === "done") return;
      const controller = cancellation();
      active = controller;
      installed = null;
      publish({ phase, preview: null, error: null });
      const work = workFor(controller);
      await run(controller, async () => {
        const preview = await load(work);
        if (!current(controller)) return;
        publish({ phase: "confirm", preview, error: null });
        if (!needsPairConfirmation(preview.match)) await commit(controller, preview);
      });
    },
    async confirm() {
      if (closed || active || !state.preview || (state.phase !== "confirm" && state.phase !== "error")) return;
      const controller = cancellation();
      active = controller;
      const preview = state.preview;
      await run(controller, () => commit(controller, preview));
    },
    /** A reader can cancel preparation/downloads, never an in-flight write. Unmount invalidates callbacks. */
    cancel(unmount = false) {
      if (!unmount && state.phase === "saving") return false;
      closed = true;
      active?.abort();
      active = null;
      installed = null;
      state = { phase: "idle", preview: null, error: null };
      return true;
    },
  };
}
