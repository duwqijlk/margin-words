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
type State = { failed: boolean; error: Error | null; componentStack?: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { failed: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("margin-words: a screen failed to draw", error, info.componentStack);
    this.setState({ error, componentStack: info.componentStack ?? "" });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-dvh place-content-center gap-3 bg-paper px-6 text-center text-ink">
        <h1 className="font-bold tracking-[-0.02em] text-xl">{tr("error.title")}</h1>
        <p className="mx-auto max-w-sm text-[0.95rem] leading-relaxed text-muted">{tr("error.body")}</p>
        <button
          type="button"
          className={`${btn.primary} mx-auto mt-1`}
          onClick={() => window.location.reload()}
          data-error-reload
        >
          {tr("error.reload")}
        </button>
        {this.state.error ? (
          <details className="mx-auto mt-3 max-w-md text-left text-xs text-muted">
            <summary className="cursor-pointer font-mono text-warn">
              {this.state.error.name}: {this.state.error.message}
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-card p-2 font-mono text-[0.7rem] text-ink border border-line">
              {this.state.error.stack || this.state.componentStack || ""}
            </pre>
          </details>
        ) : null}
      </div>
    );
  }
}
