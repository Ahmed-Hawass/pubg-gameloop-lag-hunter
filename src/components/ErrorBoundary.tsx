// ErrorBoundary.tsx — the last line of defense for a render-time crash.
//
// Without it, any exception during render unmounts the whole tree and the
// window shows nothing at all: the user sees a blank app and the only
// trace is one line in the backend log. With it, the app says plainly
// that it broke and offers a reload.
//
// The fallback reuses the design system's dialog box, so it looks like the
// rest of the app and needs no new styles.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { logFrontendError } from "../bridge";

type Props = {
  /** optional so the component can be used with React.createElement's
      third argument (the children) as well as with JSX */
  children?: ReactNode;
  /** localized fallback copy (the wrapper reads it from the locale) */
  title: string;
  body: string;
  reloadLabel: string;
};

type State = { failed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void logFrontendError(
      `boundary: ${error.message} @${info.componentStack ?? ""}`,
    ).catch(() => {});
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="dialog-overlay">
        <div className="dialog-box" role="alertdialog" aria-modal="true">
          <h3 className="dialog-title">{this.props.title}</h3>
          <p className="dialog-body">{this.props.body}</p>
          <div className="dialog-actions">
            <button
              className="focus-ring btn btn-md btn-primary"
              onClick={() => window.location.reload()}
            >
              {this.props.reloadLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
