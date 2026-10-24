import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'

/* ===========================================================================
   The composer, and the row under it.

   The reference's signature structure: the controls are a ROW UNDER the prompt
   box, not a toolbar above it. Left to right — the folder, the mode, the trust,
   the model. The prompt itself is 720px wide with a 16px radius and a 48px
   bottom band for the controls.

   Send → Stop is a cross-fade in place: the button never moves and never
   changes size, because a control that jumps under the cursor is a control
   that gets mis-clicked.
   =========================================================================== */

export type Mode = 'ask' | 'plan' | 'agent'
export type Trust = 'ask' | 'auto'

export interface ComposerProps {
  value: string
  onValueChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  running: boolean
  mode: Mode
  trust: Trust
  onModeChange: (m: Mode) => void
  onTrustChange: (t: Trust) => void
  folder: string | null
  onPickFolder: () => void
  model: string
  onPickModel: () => void
  disabled?: boolean
  placeholder?: string
}

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'agent', label: 'Agent', hint: 'Reads, writes and runs commands. Writes ask first unless full trust is on.' },
  { id: 'plan', label: 'Plan', hint: 'Reads only, then produces a plan you approve. It cannot write.' },
  { id: 'ask', label: 'Ask', hint: 'Conversation only. No tools, no reading, no changes.' },
]

export function Composer(p: ComposerProps) {
  const area = useRef<HTMLTextAreaElement>(null)
  const [focused, setFocused] = useState(false)

  /* auto-grow: one row until it needs more, capped so a paste cannot take the
     whole window */
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [p.value])

  const send = () => {
    if (p.running || !p.value.trim()) return
    p.onSend()
  }

  return (
    <div className="flex w-full flex-col items-center px-[24px] pb-[16px]">
      <div
        className="relative w-full rounded-[16px]"
        style={{
          maxWidth: 720,
          border: `1px solid ${focused ? 'var(--line-4)' : 'var(--line-1)'}`,
          background: 'var(--canvas)',
          transition: `border-color 140ms var(--ease-out)`,
        }}
      >
        <textarea
          ref={area}
          value={p.value}
          rows={1}
          disabled={p.disabled}
          onChange={(e) => p.onValueChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={
            p.placeholder ??
            (p.mode === 'agent'
              ? 'Describe what you want to build or change…'
              : p.mode === 'plan'
                ? 'Describe the work — I will plan it out for you to approve.'
                : 'Ask anything — I will answer without tools.')
          }
          aria-label="Message"
          className="block w-full resize-none overflow-hidden bg-transparent px-[16px] pt-[16px] pb-[48px] t-body outline-none"
          style={{ minHeight: 42, color: 'var(--text-1)' }}
        />

        {/* the hint sits above the band, on the right */}
        <span
          className="pointer-events-none absolute right-[16px] bottom-[calc(48px+6px)] t-tiny"
          style={{ color: 'var(--text-4)' }}
        >
          ⏎ send · ⇧⏎ newline
        </span>

        {/* the 48px band */}
        <div className="absolute bottom-0 left-0 right-0 flex h-[48px] items-center gap-[8px] px-[12px]">
          <button
            type="button"
            className="ctl grid h-[24px] w-[24px] place-items-center rounded-[6px]"
            style={{ border: '1px solid var(--line-2)' }}
            title="Attach a file"
            aria-label="Attach a file"
          >
            <span className="t-small" style={{ color: 'var(--text-3)' }}>+</span>
          </button>

          {/* the row under the prompt box: folder, mode, trust, model */}
          <button
            type="button"
            onClick={p.onPickFolder}
            className="ctl flex min-w-0 items-center gap-[6px] rounded-[4px] px-[7px] py-[2px]"
            style={{ border: '1px solid var(--line-2)' }}
            title={p.folder ?? 'Choose a folder'}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M2 4.5A1.5 1.5 0 013.5 3h3l1.5 2h4.5A1.5 1.5 0 0114 6.5v5A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span className="mono max-w-[130px] truncate t-tiny" style={{ color: 'var(--text-2)' }}>
              {p.folder ? p.folder.split(/[\\/]/).filter(Boolean).pop() : 'no folder'}
            </span>
          </button>

          <div className="flex items-center gap-[4px]" role="group" aria-label="Mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-label={`Set mode to ${m.label}`}
                aria-pressed={p.mode === m.id}
                title={`${m.label} — ${m.hint}`}
                className="ctl rounded-[4px] px-[7px] py-[2px] t-tiny"
                style={{
                  color: p.mode === m.id ? 'var(--text-1)' : 'var(--text-4)',
                  border: `1px solid ${p.mode === m.id ? 'var(--line-3)' : 'transparent'}`,
                  background: p.mode === m.id ? 'var(--surface-selected)' : 'transparent',
                }}
                onClick={() => p.onModeChange(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            aria-label="Toggle full trust"
            aria-pressed={p.trust === 'auto'}
            title={
              p.trust === 'auto'
                ? 'Full trust is on — writes run without asking, and the confidence gate still parks what it is unsure about.'
                : 'Ask first — every write and command waits for you.'
            }
            className="ctl rounded-[4px] px-[7px] py-[2px] t-tiny"
            style={{
              color: p.trust === 'auto' ? 'var(--text-1)' : 'var(--text-4)',
              border: `1px solid ${p.trust === 'auto' ? 'var(--line-3)' : 'transparent'}`,
              background: p.trust === 'auto' ? 'var(--surface-selected)' : 'transparent',
            }}
            onClick={() => p.onTrustChange(p.trust === 'auto' ? 'ask' : 'auto')}
          >
            {p.trust === 'auto' ? 'Full trust' : 'Ask first'}
          </button>

          <span className="flex-1" />

          <button
            type="button"
            onClick={p.onPickModel}
            className="ctl mono max-w-[200px] truncate rounded-[4px] px-[7px] py-[2px] t-tiny"
            style={{ color: 'var(--text-3)' }}
            title={p.model || 'No model selected'}
          >
            {p.model && p.model.length > 30 ? `${p.model.slice(0, 29)}…` : p.model || 'no model'}
          </button>

          {/* send → stop, a cross-fade in place */}
          <div className="relative h-[28px] w-[28px] shrink-0">
            {p.running ? (
              <motion.button
                key="stop"
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.09 }}
                onClick={p.onStop}
                aria-label="Stop the run"
                title="Stop"
                className="ctl absolute inset-0 grid place-items-center rounded-[8px]"
                style={{ background: 'var(--btn-primary)', color: 'var(--btn-primary-text)' }}
              >
                <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
                  <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="currentColor" />
                </svg>
              </motion.button>
            ) : (
              <motion.button
                key="send"
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.09 }}
                onClick={send}
                disabled={p.disabled || !p.value.trim()}
                aria-label="Send"
                title="Send"
                className="ctl absolute inset-0 grid place-items-center rounded-[8px]"
                style={{
                  background: 'var(--btn-primary)',
                  color: 'var(--btn-primary-text)',
                  opacity: p.disabled || !p.value.trim() ? 0.45 : 1,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
                  <path d="M7 11.5v-9M3.5 6L7 2.5 10.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
