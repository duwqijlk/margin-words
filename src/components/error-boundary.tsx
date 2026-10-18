import { Component, type ErrorInfo, type ReactNode } from "react";
import { btn } from "@/components/ui";
import { tr } from "@/lib/i18n";

/**
 * The last line of defence around the whole app. Without it, one throw while a screen draws
 * (the reader builds and rewrites a lot of DOM, and chapter HTML is injected) unmounts the tree
 * and leaves a blank page with no way back. React still reports the error to the console.
 *
 * Nothing is sent anywhere: the app has no error reporting service, and this stays that way.
 * The fallback only offers a reload. Books, saved words and reading places live in IndexedDB,
 * so a reload does not lose them.
 */
type Props = { children: ReactNode };
type State = { failed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("margin-words: a screen failed to draw", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-dvh place-content-center gap-3 bg-paper px-6 text-center text-ink">
        <h1 className="font-display text-xl font-semibold">{tr("error.title")}</h1>
        <p className="mx-auto max-w-sm text-[0.95rem] leading-relaxed text-muted">{tr("error.body")}</p>
        <button
          type="button"
          className={`${btn.primary} mx-auto mt-1`}
          onClick={() => window.location.reload()}
          data-error-reload
        >
          {tr("error.reload")}
        </button>
      </div>
    );
  }
}
