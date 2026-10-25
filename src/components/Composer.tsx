import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Mark } from './Mark'

/* ===========================================================================
   The composer.

   Three things it must never do, learned the hard way:

   1. LOSE FOCUS. Switching an IME between Arabic and English drops the
      composition if React re-creates the textarea. So the element is stable:
      one component, one ref, no key that changes, no conditional wrapper. The
      textarea is never disabled — a disabled field is a field you must click
      again, and the reason it was disabled (no model) is stated in the row
      instead.
   2. CHANGE SHAPE. It is a rounded field with a soft shadow at rest and the
      same field on focus; only the border darkens. A control that becomes a
      different control when you touch it is a control that startles.
   3. JUMP. Send becomes Stop by cross-fading in place, at the same size, in
      the same position.

   The row under the field is the reference's signature: the folder, the
   permission mode, the model — under the prompt, where the hands already are.
   =========================================================================== */

export type Mode = 'ask' | 'plan' | 'agent'
export type Trust = 'ask' | 'auto'

export interface ComposerProps {
  /** the field is uncontrolled: this is only the initial value, and the shell
      reads the real one from the ref on send */
  value: string
  onValueChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  running: boolean
  mode: Mode
  trust: Trust
  folder: string | null
  onPickFolder: () => void
  model: string
  onPickModel: () => void
  attachments?: File[]
  onAttach?: (files: File[]) => void
  /** why the composer cannot send, if it cannot — shown in the row */
  blockedReason?: string | null
  onOpenModeMenu: () => void
  /** Home has no folder — a conversation is not tied to one */
  showFolder?: boolean
}

const MODE_LABEL: Record<Mode, string> = { agent: 'Agent', plan: 'Plan', ask: 'Ask' }

export function Composer(p: ComposerProps) {
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)

  /* auto-grow: one row until it needs more, capped so a paste cannot take the
     window. The height is set on the element, never through React state — a
     state write here would re-render on every keystroke. */
  /* the shell clears the field after a send; that is the only time the element
     is written from outside */
  useEffect(() => {
    const el = area.current
    if (!el) return
    if (p.value === '') {
      el.value = ''
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [p.value])

  const canSend = p.value.trim().length > 0 && !p.running && !p.blockedReason

  const send = () => {
    if (!canSend) return
    p.onSend()
  }

  return (
    <div className="flex w-full flex-col items-center px-[24px]">
      <div className="w-full" style={{ maxWidth: 'var(--thread-measure)' }}>
        <motion.div
          initial={false}
          animate={{
            borderColor: focused ? 'var(--line-4)' : 'var(--line-2)',
            boxShadow: focused ? '0 6px 20px rgba(0,0,0,0.08)' : '0 4px 14px rgba(0,0,0,0.05)',
          }}
          transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
          className="relative"
          style={{
            /* a pill: the radius is half the resting height, and it stays a
               pill as the field grows */
            borderRadius: 999,
            border: '1px solid var(--line-2)',
            background: 'var(--canvas)',
          }}
        >
          <textarea
            ref={area}
            defaultValue={p.value}
            rows={1}
            onChange={(e) => {
              p.onValueChange(e.target.value)
              const el = area.current
              if (!el) return
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 220)}px`
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              /* Enter sends; Shift+Enter and an IME composition do not */
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="What are we building?"
            aria-label="Message"
            className="block w-full resize-none overflow-y-auto bg-transparent px-[20px] pt-[15px] pb-[42px] t-body outline-none"
            style={{ minHeight: 78, maxHeight: 220, color: 'var(--text-1)' }}
          />

          {/* the row under the field */}
          <div className="absolute bottom-0 left-0 right-0 flex h-[44px] flex-wrap items-center gap-x-[6px] gap-y-[2px] px-[12px]">
            <button
              type="button"
              className="ctl grid h-[26px] w-[26px] place-items-center rounded-[8px]"
              style={{ border: '1px solid var(--line-2)' }}
              title="Attach a file"
              aria-label="Attach a file"
              onClick={() => picker.current?.click()}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                if (files.length) p.onAttach?.(files)
                e.target.value = ''
              }}
            />

            {p.attachments && p.attachments.length > 0 && (
              <span className="t-tiny" style={{ color: 'var(--text-3)' }}>
                {p.attachments.length} file{p.attachments.length > 1 ? 's' : ''}
              </span>
            )}

            {/* the mode chip opens the reference's numbered menu */}
            <button
              type="button"
              onClick={p.onOpenModeMenu}
              aria-label="Permission mode"
              aria-haspopup="menu"
              className="ctl flex items-center gap-[5px] rounded-[8px] px-[8px] py-[3px] t-small"
              style={{ color: 'var(--text-2)' }}
            >
              {p.trust === 'auto' ? 'Full trust' : MODE_LABEL[p.mode]}
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M3 4.5L6 7.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>

            <span className="flex-1" />

            {/* the model chip already says "no model"; repeating it as a
                blocked reason would be the same fact twice in one row */}
            {p.blockedReason && p.blockedReason !== 'no model' && (
              <span className="t-tiny max-w-[220px] truncate" style={{ color: 'var(--text-3)' }} title={p.blockedReason}>
                {p.blockedReason}
              </span>
            )}

            <button
              type="button"
              onClick={p.onPickModel}
              className="ctl mono max-w-[190px] truncate rounded-[8px] px-[8px] py-[3px] t-small"
              style={{ color: 'var(--text-3)' }}
              title={p.model || 'No model selected'}
            >
              {p.model && p.model.length > 26 ? `${p.model.slice(0, 25)}…` : p.model || 'no model'}
            </button>

            {/* send → stop: a cross-fade in place, same box, same spot */}
            <div className="relative h-[28px] w-[28px] shrink-0">
              <AnimatePresence initial={false} mode="popLayout">
                {p.running ? (
                  <motion.button
                    key="stop"
                    type="button"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
                    onClick={p.onStop}
                    aria-label="Stop the run"
                    title="Stop"
                    className="ctl absolute inset-0 grid place-items-center rounded-[9px]"
                    style={{ background: 'var(--btn-primary)', color: 'var(--btn-primary-text)' }}
                  >
                    <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden>
                      <rect x="1.6" y="1.6" width="8.8" height="8.8" rx="1.6" fill="currentColor" />
                    </svg>
                  </motion.button>
                ) : (
                  <motion.button
                    key="send"
                    type="button"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
                    onClick={send}
                    disabled={!canSend}
                    aria-label="Send"
                    title={p.blockedReason ?? 'Send'}
                    className="ctl absolute inset-0 grid place-items-center rounded-[9px]"
                    style={{
                      background: 'var(--btn-primary)',
                      color: 'var(--btn-primary-text)',
                      opacity: canSend ? 1 : 0.35,
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
                      <path
                        d="M7 11.6V2.6M3.4 6.2L7 2.6l3.6 3.6"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                      />
                    </svg>
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>

        {/* the floor of the composer: where you are, and the one key that sends */}
        <div className="mt-[10px] flex items-center gap-[10px] px-[4px]">
          {p.showFolder !== false && (
          <button
            type="button"
            onClick={p.onPickFolder}
            className="ctl flex min-w-0 items-center gap-[6px] rounded-[7px] px-[7px] py-[3px] t-tiny"
            style={{ color: 'var(--text-3)' }}
            title={p.folder ?? 'Choose a folder'}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M2 4.5A1.5 1.5 0 013.5 3h3l1.5 2h4.5A1.5 1.5 0 0114 6.5v5A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5v-7z"
                stroke="currentColor"
                strokeWidth="1.3"
              />
            </svg>
            <span className="mono max-w-[150px] truncate">
              {p.folder ? p.folder.split(/[\\/]/).filter(Boolean).pop() : 'choose a folder'}
            </span>
          </button>
          )}

          <span className="flex-1" />

          <span className="t-tiny" style={{ color: 'var(--text-4)' }}>
            ⏎ send · ⇧⏎ newline
          </span>
          <Mark size={11} />
        </div>
      </div>
    </div>
  )
}
