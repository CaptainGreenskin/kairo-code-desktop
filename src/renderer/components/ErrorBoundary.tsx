import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  title?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <ErrorFallback
          title={this.props.title ?? 'Something went wrong'}
          error={this.state.error}
          onReset={() => this.setState({ error: null })}
        />
      )
    }
    return this.props.children
  }
}

function ErrorFallback({
  title,
  error,
  onReset
}: {
  title: string
  error: Error
  onReset: () => void
}): JSX.Element {
  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(error.stack ?? error.message)
    } catch { /* ignore */ }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8 bg-surface-1">
      <div className="max-w-md w-full rounded-xl border border-border bg-surface-2 p-6 shadow-lg">
        <div className="flex items-center gap-2 mb-3">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-danger shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        </div>
        <pre className="text-[12px] font-mono text-text-secondary bg-surface-0 rounded-md p-3 overflow-auto max-h-40 border border-border mb-4">
          {error.message}
        </pre>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 text-[13px] rounded-md bg-accent hover:bg-accent-hover text-white transition-colors"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="px-3 py-1.5 text-[13px] rounded-md bg-surface-3 hover:bg-surface-0 text-text-primary border border-border transition-colors"
          >
            Copy Error
          </button>
          <button
            type="button"
            onClick={onReset}
            className="px-3 py-1.5 text-[13px] rounded-md bg-surface-3 hover:bg-surface-0 text-text-secondary border border-border transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  )
}
