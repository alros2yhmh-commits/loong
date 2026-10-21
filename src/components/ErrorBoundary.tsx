import { Component, type ReactNode } from 'react'

/* ---------------------------------------------------------------------------
   Error boundary.

   A render error in one component must never leave a white window. This catches
   it, keeps the app alive, and shows the message plus a reload — the difference
   between "a bug" and "the app is broken".
   --------------------------------------------------------------------------- */

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    try {
      console.error('[loong] render error', error)
    } catch {
      /* nothing else to do */
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-[12px] px-[24px]"
        style={{ background: 'var(--canvas)' }}
      >
        <p className="display m-0 text-[15px]" style={{ color: 'var(--text-1)' }}>
          Something went wrong rendering this view.
        </p>
        <p
          className="mono m-0 max-w-[520px] text-center text-[11px] leading-[1.6]"
          style={{ color: 'var(--text-4)' }}
        >
          {this.state.error.message}
        </p>
        <button
          type="button"
          className="ctl rounded-[7px] px-[13px] py-[6px] text-[12px]"
          style={{ border: '1px solid var(--line-3)', color: 'var(--text-2)' }}
          onClick={() => {
            this.setState({ error: null })
            try {
              location.reload()
            } catch {
              /* ignore */
            }
          }}
        >
          Reload
        </button>
      </div>
    )
  }
}
