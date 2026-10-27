import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { t, e } from '../lib/motion'
import { Mark } from './Dragon'

/* ===========================================================================
   The composer.

   The layout is a COLUMN, not a stack of absolutes: the textarea is in normal
   flow and grows, and the controls sit under it in the same flow. That is the
   whole reason the old one overflowed — its control band was absolutely
   positioned inside a fixed-height box, so a fourth line of text ran underneath
   it.

   It grows to 220px and then scrolls inside itself.

   The field is uncontrolled: an IME composition survives a re-render only if
   React never rewrites the element's value. Enter sends, Shift+Enter breaks the
   line, and an active composition never sends.
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
  folder: string | null
  showFolder?: boolean
  onPickFolder: () => void
  model: string
  onPickModel: () => void
  blockedReason?: string | null
  onOpenModeMenu: () => void
  onAttach?: (files: File[]) => void
  attachments?: File[]
  onRemoveAttachment?: (index: number) => void
}

const MODE_LABEL: Record<Mode, string> = { agent: 'Agent', plan: 'Plan', ask: 'Chat' }

export function Composer(p: ComposerProps) {
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)

  const grow = () => {
    const el = area.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }

  /* the height is written straight to the element: a state write here would
     re-render the tree on every keystroke */
  useEffect(grow, [p.value])

  useEffect(() => {
    if (p.value === '' && area.current) {
      area.current.value = ''
      grow()
    }
  }, [p.value])

  /* An attachment is content. Requiring a typed character made the file picker
     a decoration: a screenshot or a log with no words is a legitimate ask. */
  const hasContent = p.value.trim().length > 0 || (p.attachments?.length ?? 0) > 0
  const canSend = hasContent && !p.running && !p.blockedReason

  const send = () => {
    if (!canSend) return
    p.onSend()
  }

  return (
    <div className="flex w-full flex-col items-center px-[28px]">
      <div className="w-full" style={{ maxWidth: 'var(--thread-measure)' }}>
        <motion.div
          initial={false}
          animate={{
            borderColor: focused ? 'var(--line-3)' : 'var(--line-2)',
            boxShadow: focused ? 'var(--shadow-2)' : 'var(--shadow-1)',
          }}
          transition={{ duration: t.fast, ease: e.out }}
          className="flex flex-col overflow-hidden"
          style={{
            borderRadius: 14,
            border: '1px solid var(--line-2)',
            background: 'var(--raised)',
          }}
        >
          {/* the field — normal flow, so the controls can never sit on it */}
          <textarea
            ref={area}
            defaultValue={p.value}
            rows={1}
            onChange={(ev) => {
              p.onValueChange(ev.target.value)
              grow()
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
                ev.preventDefault()
                send()
              }
            }}
            placeholder={p.mode === 'ask' ? 'Ask anything' : 'Describe the work'}
            aria-label="Message"
            className="block w-full resize-none overflow-y-auto bg-transparent px-[16px] pt-[13px] pb-[4px] t-body outline-none"
            style={{ maxHeight: 220, color: 'var(--text-1)' }}
          />

          {/* the controls, in flow */}
          <div className="flex flex-wrap items-center gap-[6px] px-[10px] py-[8px]">
            <button
              type="button"
              className="ctl grid h-[26px] w-[26px] place-items-center rounded-[7px]"
              style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
              title="Attach a file"
              aria-label="Attach a file"
              onClick={() => picker.current?.click()}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M8 3.4v9.2M3.4 8h9.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={(ev) => {
                const files = [...(ev.target.files ?? [])]
                if (files.length) p.onAttach?.(files)
                ev.target.value = ''
              }}
            />

            {p.attachments && p.attachments.length > 0 && (
              <span className="flex flex-wrap items-center gap-[5px]">
                {p.attachments.map((f, i) => {
                  const isImg = f.type.startsWith('image/')
                  const isText =
                    f.type.startsWith('text/') ||
                    /\.(md|txt|json|ts|tsx|js|jsx|css|html|yml|yaml|csv|log|toml|py|go|rs|java|c|h|cpp|sh)$/i.test(f.name)
                  const tag = isImg ? 'IMG' : isText ? 'TXT' : 'FILE'
                  return (
                    <span
                      key={i}
                      className="flex items-center gap-[5px] rounded-[7px] px-[7px] py-[3px]"
                      style={{ border: '1px solid var(--line-2)', background: 'var(--surface)' }}
                      title={f.name}
                    >
                      <span className="mono t-tiny" style={{ color: 'var(--text-3)' }}>
                        {tag}
                      </span>
                      <span className="t-tiny max-w-[150px] truncate" style={{ color: 'var(--text-2)' }}>
                        {f.name}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => p.onRemoveAttachment?.(i)}
                        className="ctl grid h-[14px] w-[14px] place-items-center rounded-[4px]"
                        style={{ color: 'var(--text-3)' }}
                      >
                        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" aria-hidden>
                          <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                      </button>
                    </span>
                  )
                })}
              </span>
            )}

            {p.showFolder !== false && (
              <button
                type="button"
                onClick={p.onPickFolder}
                className="ctl flex min-w-0 items-center gap-[6px] rounded-[7px] px-[7px] py-[3px] t-tiny"
                style={
                  p.folder
                    ? { color: 'var(--text-3)' }
                    : { color: 'var(--amber)', background: 'var(--amber-dim)' }
                }
                title={p.folder ? `Working in ${p.folder} — click to change` : 'Choose the folder the agent may read and write'}
                aria-label={p.folder ? `Workspace: ${p.folder}` : 'Choose a folder'}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M2 4.5A1.5 1.5 0 013.5 3h3l1.5 2h4.5A1.5 1.5 0 0114 6.5v5A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5v-7z"
                    stroke="currentColor"
                    strokeWidth="1.3"
                  />
                </svg>
                <span className="mono max-w-[150px] truncate">
                  {p.folder
                    ? p.folder.split(/[\\/]/).filter(Boolean).slice(-2).join('/')
                    : 'open a folder'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={p.onOpenModeMenu}
              aria-label="Permission mode"
              aria-haspopup="menu"
              className="ctl flex items-center gap-[5px] rounded-[7px] px-[7px] py-[3px] t-tiny"
              style={{
                color: p.trust === 'auto' ? 'var(--amber)' : 'var(--text-3)',
                background: p.trust === 'auto' ? 'var(--amber-dim)' : 'transparent',
              }}
            >
              {p.trust === 'auto' ? 'Full trust' : MODE_LABEL[p.mode]}
              <svg width="8" height="8" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M3 4.6L6 7.4l3-2.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>

            <span className="flex-1" />

            {p.blockedReason && (
              <span className="t-tiny max-w-[200px] truncate" style={{ color: 'var(--text-3)' }} title={p.blockedReason}>
                {p.blockedReason}
              </span>
            )}

            <button
              type="button"
              onClick={p.onPickModel}
              className="ctl mono max-w-[180px] truncate rounded-[7px] px-[7px] py-[3px] t-tiny"
              style={{ color: 'var(--text-3)' }}
              title={p.model || 'No model selected'}
            >
              {p.model && p.model.length > 24 ? `${p.model.slice(0, 23)}…` : p.model || 'no model'}
            </button>

            <div className="relative h-[28px] w-[28px] shrink-0">
              <AnimatePresence initial={false} mode="popLayout">
                {p.running ? (
                  <motion.button
                    key="stop"
                    type="button"
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ duration: t.fast, ease: e.out }}
                    onClick={p.onStop}
                    aria-label="Stop the run"
                    title="Stop — Esc"
                    className="ctl absolute inset-0 grid place-items-center rounded-[8px]"
                    style={{ background: 'var(--amber)', color: '#141416' }}
                  >
                    <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden>
                      <rect x="1.6" y="1.6" width="8.8" height="8.8" rx="1.8" fill="currentColor" />
                    </svg>
                  </motion.button>
                ) : (
                  <motion.button
                    key="send"
                    type="button"
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ duration: t.fast, ease: e.out }}
                    onClick={send}
                    disabled={!canSend}
                    aria-label="Send"
                    title={p.blockedReason ?? 'Send — Enter'}
                    className="ctl absolute inset-0 grid place-items-center rounded-[8px]"
                    style={{
                      background: canSend ? 'var(--btn)' : 'var(--btn-disabled)',
                      color: canSend ? 'var(--btn-text)' : 'var(--btn-disabled-text)',
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
                      <path
                        d="M7 11.4V2.8M3.6 6.2L7 2.8l3.4 3.4"
                        stroke="currentColor"
                        strokeWidth="1.8"
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

        <div className="mt-[8px] flex items-center gap-[10px] px-[2px]">
          <span className="t-tiny" style={{ color: 'var(--text-4)' }}>
            ⏎ send · ⇧⏎ newline
          </span>
          <span className="flex-1" />
          <Mark size={10} />
        </div>
      </div>
    </div>
  )
}
