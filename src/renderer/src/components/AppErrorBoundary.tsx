import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from '../i18n'
import { reportRendererError } from '../lib/global-error-reporter'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary] uncaught render error:', error, info.componentStack)
    const errorWithComponentStack = new Error(error.message)
    errorWithComponentStack.name = error.name
    errorWithComponentStack.stack = [error.stack, info.componentStack].filter(Boolean).join('\n')
    // force: boundary reports carry the only componentStack; a same-signature
    // report inside the dedupe window (e.g. reload hitting the same render
    // error) must still reach the crash store.
    reportRendererError({ error: errorWithComponentStack }, 'Uncaught render error', { force: true })
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center bg-ds-main px-6">
        <div className="w-full max-w-md rounded-2xl border border-ds-warning-soft bg-ds-warning-soft p-6 text-center shadow-[var(--c360-shadow-sm)]">
          <h2 className="text-[16px] font-semibold text-ds-warning">
            {i18n.t('appErrorTitle')}
          </h2>
          <p className="mt-2 text-[13px] leading-5 text-ds-muted">
            {this.state.error.message || String(this.state.error)}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-4 rounded-full bg-ds-warning px-5 py-2 text-[13px] font-medium text-white transition hover:brightness-110"
          >
            {i18n.t('appErrorReload')}
          </button>
        </div>
      </div>
    )
  }
}
