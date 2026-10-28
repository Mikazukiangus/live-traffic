import React, { Component, type ReactNode } from 'react';
import { reportApplicationFailure } from '../../shared/applicationDiagnostics';

interface Props { scope: 'page' | 'app'; children: ReactNode }
interface State { failed: boolean; retried: boolean; errorId?: string }

/** One local retry per mounted page. Navigation remounts it; reload is always explicit. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, retried: false };
  static getDerivedStateFromError(): Partial<State> { return { failed: true }; }
  componentDidCatch(error: unknown) {
    const result = reportApplicationFailure(this.props.scope, error, 'react_boundary');
    this.setState({ errorId: result.errorId });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const page = this.props.scope === 'page';
    return (
      <section role="alert" className="mx-auto my-12 w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-slate-900">
        <h2 className="text-lg font-bold">{page ? 'This view couldn’t load' : 'TrafficPulse couldn’t load'}</h2>
        <p className="mt-2 text-sm text-slate-600">
          {page ? 'You can switch tabs or reload the page to try again.' : 'Reload the page or open the cameras view to try again.'}
        </p>
        {this.state.errorId && <p className="mt-3 break-all text-xs text-slate-500">Reference: {this.state.errorId}</p>}
        <div className="mt-5 flex flex-wrap gap-3">
          {page && !this.state.retried && (
            <button type="button" onClick={() => this.setState({ failed: false, retried: true, errorId: undefined })}
              className="min-h-11 rounded-full bg-sky-600 px-5 text-sm font-semibold text-white hover:bg-sky-700 cursor-pointer">Try again</button>
          )}
          <button type="button" onClick={() => window.location.reload()}
            className="min-h-11 rounded-full border border-slate-300 px-5 text-sm font-semibold hover:bg-slate-100 cursor-pointer">Reload page</button>
          {!page && <a href="/?page=cameras" className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-sky-700 underline">Open cameras</a>}
        </div>
      </section>
    );
  }
}
