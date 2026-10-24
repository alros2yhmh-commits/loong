import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentPhase } from '../lib/contract'
import { useSettings } from '../lib/settings'
import { dur, easeOut, spring } from '../motion/tokens'
import { sound } from '../lib/sound'
import { IconSend, IconStop } from './Icons'

/* ---------------------------------------------------------------------------
   The composer.

   Pinned to the bottom of the centre column and never moves. The only thing
   that changes about it during a run is the primary action, which becomes Stop
   in place — no second button, no pointer travel to cancel.
   --------------------------------------------------------------------------- */

interface ComposerProps {
  phase: AgentPhase
  running: boolean
  onSend: (text: string, images: string[]) => void
  onStop: () => void
  /** the mode the next run will actually use — owned by App, not this control */
  mode: 'ask' | 'plan' | 'agent'
  onModeChange: (mode: 'ask' | 'plan' | 'agent') => void
  /** 'auto' means the agent runs every write without stopping to ask */
  trust: 'ask' | 'auto'
  onToggleTrust: () => void
  /** whether the selected model accepts images — null when unknown */
  modelVision?: boolean | null
  /** what is waiting for the current run to finish, if anything */
  queued?: { text: string; images: string[] } | null
  onCancelQueue?: () => void
  /** a seed for the ↑ gesture: drop the last message back into the composer */
  editSeed?: { text: string; at: number } | null
  /** a seed from elsewhere — a selection action carries text into the composer */
  prefill?: { text: string; at: number } | null
  /** suggested next messages, from the last answer */
  suggestions?: string[]
}

const MODES = [
  { id: 'agent', label: 'Agent' },
  { id: 'plan', label: 'Plan' },
  { id: 'ask', label: 'Ask' },
] as const

/** the app's own slash commands, offered alongside the reader's saved ones */
const BUILTIN_SLASH: { name: string; hint: string }[] = [
  { name: 'clear', hint: 'start a fresh thread' },
  { name: 'delete', hint: 'delete this thread (asks first)' },
  { name: 'model', hint: 'switch model, or /model to open Settings' },
  { name: 'workspace', hint: 'change the folder the agent works in' },
  { name: 'help', hint: 'the command list' },
]

const PHASE_LABEL: Record<AgentPhase, string> = {
  idle: 'ready',
  thinking: 'thinking',
  streaming: 'writing',
  tool: 'running a tool',
  awaiting: 'waiting on you',
  error: 'stopped on an error',
  done: 'done',
}

export function Composer({
  phase,
  running,
  onSend,
  onStop,
  mode,
  onModeChange,
  trust,
  onToggleTrust,
  modelVision = null,
  queued,
  onCancelQueue,
  editSeed,
  prefill,
  suggestions = [],
}: ComposerProps) {
  const [value, setValue] = useState('')
  /** a file dropped on the composer becomes part of the message, as text */
  const [dropping, setDropping] = useState(false)
  const [focused, setFocused] = useState(false)
  const [images, setImages] = useState<string[]>([])
  const [mention, setMention] = useState<{ query: string; from: number } | null>(null)
  const [files, setFiles] = useState<string[]>([])
  /* a leading "/word" is a command — saved ones first, then the built-ins */
  const [slash, setSlash] = useState<{ query: string } | null>(null)
  const { settings } = useSettings()
  const area = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const reduced = useReducedMotion()

  const slashMatches = useMemo(() => {
    if (!slash) return []
    const q = slash.query.toLowerCase()
    const saved = settings.commands.map((c) => ({ name: c.name, hint: c.hint ?? c.prompt.slice(0, 48) }))
    return [...saved, ...BUILTIN_SLASH].filter((c) => c.name.startsWith(q)).slice(0, 6)
  }, [slash, settings.commands])

  /* the ↑ gesture: the last message comes back to be edited, cursor at end */
  useEffect(() => {
    if (!editSeed) return
    setValue(editSeed.text)
    requestAnimationFrame(() => {
      const el = area.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }, [editSeed])

  /* a selection action from the thread (explain / ask / add-to-context) drops
     its text here the same way, cursor at the end so the reader keeps writing */
  useEffect(() => {
    if (!prefill) return
    setValue(prefill.text)
    requestAnimationFrame(() => {
      const el = area.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }, [prefill])

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 190)}px`
  }, [value])

  const submit = useCallback(() => {
    const text = value.trim()
    if (!text) return
    sound.play('send')
    /* a run in flight no longer blocks the composer: the message is queued and
       sent the moment the turn ends, so a thought is never lost to a busy agent */
    onSend(text, images)
    setValue('')
    setImages([])
  }, [value, images, onSend])

  /* registered once, reading the latest submit through a ref — during a run
     this component re-renders every ~40ms and re-binding the listener each
     time is pure waste */
  const submitRef = useRef(submit)
  submitRef.current = submit

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        submitRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* an image pasted or dropped onto the composer rides with the next message */
  const addImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    if (file.size > 6 * 1024 * 1024) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImages((prev) => [...prev.slice(-3), reader.result as string].slice(-4))
      }
    }
    reader.readAsDataURL(file)
  }, [])

  /* a non-image file is text the model should read: fold it into the message
     as a fenced block, capped so a huge log cannot blow the turn */
  const addFile = useCallback(
    (file: File) => {
      if (file.type.startsWith('image/')) {
        addImageFile(file)
        return
      }
      if (file.size > 200 * 1024) return
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result !== 'string') return
        const body = reader.result
        setValue((prev) => `${prev}${prev ? '\n\n' : ''}\`\`\`${file.name}\n${body}\n\`\`\`\n`)
      }
      reader.readAsText(file)
    },
    [addImageFile],
  )

  /* @file: the last "@word" being typed, and the workspace files that match */
  const trackMention = useCallback((text: string, caret: number) => {
    const upto = text.slice(0, caret)
    const m = /(^|\s)@([\w./-]*)$/.exec(upto)
    if (!m) {
      setMention(null)
      return
    }
    const query = m[2]
    const from = caret - query.length - 1
    setMention({ query, from })
    void fetch(
      `${typeof window !== 'undefined' && window.location.protocol === 'file:' ? 'http://127.0.0.1:5274' : ''}/api/files?q=${encodeURIComponent(query)}`,
    )
      .then((r) => r.json())
      .then((b: { files?: string[] }) => setFiles((b.files ?? []).slice(0, 8)))
      .catch(() => setFiles([]))
  }, [])

  const insertMention = useCallback(
    (path: string) => {
      if (!mention) return
      const el = area.current
      const caret = el?.selectionStart ?? mention.from + mention.query.length + 1
      const next = `${value.slice(0, mention.from)}@${path} ${value.slice(caret)}`
      setValue(next)
      setMention(null)
      el?.focus()
    },
    [mention, value],
  )

  /* picking a command drops "/name " into the box; the reader adds arguments */
  const insertSlash = useCallback((name: string) => {
    setValue(`/${name} `)
    setSlash(null)
    requestAnimationFrame(() => {
      const el = area.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }, [])

  /* THE primary action is Stop for exactly as long as a turn is in flight.
     This used to be `running && phase !== 'done' && phase !== 'error'`, which
     meant a run that failed flipped the button back to Send while `running`
     was still true — and send() early-returns on `running`. The result was a
     button that looked ready and did nothing, with no way to cancel. The phase
     is a description of the run; it must never gate the control. */
  const busy = running
  const canSend = value.trim().length > 0

  return (
    <div
      className="shrink-0 px-[24px] pt-[6px] pb-[12px]"
      onDragOver={(e) => {
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={async (e) => {
        e.preventDefault()
        setDropping(false)
        /* code is text: up to five files, 200 KB each, appended to the draft */
        const files = Array.from(e.dataTransfer.files).slice(0, 5)
        for (const file of files) {
          if (file.size > 200_000) continue
          const text = await file.text().catch(() => '')
          if (!text) continue
          setValue((v) => `${v}${v ? '\n\n' : ''}[file: ${file.name}]\n${text}`)
        }
      }}
      style={dropping ? { outline: '1px dashed var(--line-5)', outlineOffset: -3 } : undefined}
    >
      <div
        className="mx-auto"
        style={{ maxWidth: 'var(--thread-measure)' }}
      >
        {/* status line — derived from the stream, never stored separately */}
        <div className="mb-[5px] flex items-center gap-[7px] px-[2px]">
          <motion.span
            className="inline-block h-[5px] w-[5px] rounded-full"
            style={{
              background:
                phase === 'error'
                  ? 'var(--text-1)'
                  : busy
                    ? 'var(--text-2)'
                    : 'var(--line-5)',
            }}
            animate={
              busy && !reduced
                ? { opacity: [1, 0.25, 1], scale: [1, 0.82, 1] }
                : { opacity: 1, scale: 1 }
            }
            transition={{ duration: 1.5, repeat: busy ? Infinity : 0, ease: easeOut }}
          />
          <span
            className="mono text-[10.5px]"
            style={{ color: 'var(--text-4)' }}
          >
            {PHASE_LABEL[phase]}
          </span>
        </div>

        {!busy && value.trim() === '' && suggestions.length > 0 && (
          <div className="mb-[5px] flex flex-wrap gap-[5px] px-[2px]">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                className="ctl rounded-[5px] px-[8px] py-[3px] text-[10.5px]"
                style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setValue(s)
                  requestAnimationFrame(() => {
                    const el = area.current
                    if (!el) return
                    el.focus()
                    el.setSelectionRange(el.value.length, el.value.length)
                  })
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div
          className="relative rounded-[11px]"
          style={{
            border: `1px solid ${focused ? 'var(--line-4)' : 'var(--line-2)'}`,
            background: 'var(--surface-sunken)',
            transition: `border-color ${dur.hover * 1000}ms var(--ease-out)`,
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            for (const f of Array.from(e.dataTransfer.files)) addFile(f)
          }}
        >
          {/* the focus ring draws itself, left to right, rather than fading in */}
          <motion.div
            className="absolute -top-px -right-px -left-px h-px origin-left rounded-full"
            style={{ background: 'var(--line-5)' }}
            initial={false}
            animate={{ scaleX: focused ? 1 : 0, opacity: focused ? 1 : 0 }}
            transition={{ duration: dur.enter, ease: easeOut }}
          />

          {/* what is waiting for the run to finish — never a surprise */}
          {queued && (
            <div
              className="flex items-center gap-[8px] px-[12px] pt-[8px]"
              style={{ color: 'var(--text-4)' }}
            >
              <span className="mono text-[10.5px]">queued</span>
              <span className="mono min-w-0 flex-1 truncate text-[10.5px]">
                {queued.text}
                {queued.images.length ? ` · ${queued.images.length} image(s)` : ''}
              </span>
              {onCancelQueue && (
                <button
                  type="button"
                  className="ctl rounded-[4px] px-[6px] py-[1px] text-[10.5px]"
                  style={{ border: '1px solid var(--line-2)' }}
                  onClick={onCancelQueue}
                >
                  remove
                </button>
              )}
            </div>
          )}

          {/* pasted images, as a strip of thumbnails above the input */}
          {images.length > 0 && (
            <div className="flex gap-[6px] px-[12px] pt-[9px]">
              {images.map((src, i) => (
                <div key={i} className="relative">
                  <img
                    src={src}
                    alt={`attachment ${i + 1}`}
                    className="h-[44px] w-[44px] rounded-[5px] object-cover"
                    style={{ border: '1px solid var(--line-3)' }}
                  />
                  <button
                    type="button"
                    aria-label="remove image"
                    className="absolute -top-[6px] -right-[6px] grid h-[16px] w-[16px] place-items-center rounded-full text-[9px]"
                    style={{
                      background: 'var(--canvas)',
                      border: '1px solid var(--line-3)',
                      color: 'var(--text-2)',
                    }}
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* a model that cannot see: say it before the run, not three times after */}
          {images.length > 0 && modelVision === false && (
            <p
              className="mono m-0 px-[12px] pt-[6px] text-[10.5px] leading-[1.5]"
              style={{ color: 'var(--text-3)' }}
            >
              This model cannot read images. The image will be dropped and the text
              sent on its own.
            </p>
          )}

          {/* @file completion */}
          <AnimatePresence>
            {mention && files.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 3 }}
                transition={{ duration: dur.enter, ease: easeOut }}
                className="absolute bottom-full left-0 z-10 mb-[6px] w-full overflow-hidden rounded-[8px]"
                style={{
                  border: '1px solid var(--line-3)',
                  background: 'var(--canvas)',
                }}
              >
                {files.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className="mono block w-full truncate px-[11px] py-[6px] text-left text-[11.5px]"
                    style={{ color: 'var(--text-2)' }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      insertMention(f)
                    }}
                  >
                    {f}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* /command completion — the reader's saved commands, then the built-ins */}
          <AnimatePresence>
            {slash && slashMatches.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 3 }}
                transition={{ duration: dur.enter, ease: easeOut }}
                className="absolute bottom-full left-0 z-10 mb-[6px] w-full overflow-hidden rounded-[8px]"
                style={{ border: '1px solid var(--line-3)', background: 'var(--canvas)' }}
              >
                {slashMatches.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    className="block w-full px-[11px] py-[6px] text-left"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      insertSlash(c.name)
                    }}
                  >
                    <span className="mono text-[11.5px]" style={{ color: 'var(--text-1)' }}>
                      /{c.name}
                    </span>
                    <span className="mono ml-[9px] text-[10.5px]" style={{ color: 'var(--text-4)' }}>
                      {c.hint}
                    </span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              for (const f of Array.from(e.target.files ?? [])) addFile(f)
              e.target.value = ''
            }}
          />

          <textarea
            ref={area}
            value={value}
            onChange={(e) => {
              const v = e.target.value
              setValue(v)
              trackMention(v, e.target.selectionStart ?? 0)
              /* a leading slash with no space yet is a half-typed command */
              setSlash(v.startsWith('/') && !v.includes(' ') ? { query: v.slice(1) } : null)
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false)
              setMention(null)
              setSlash(null)
            }}
            onPaste={(e) => {
              for (const f of Array.from(e.clipboardData.files)) addFile(f)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={1}
            /* one composer, two writing systems: each line takes its own
               direction from its first strong character, so an Arabic sentence
               and a file path in the same message do not fight each other */
            dir="auto"
            placeholder="Ask Loong to do something…  (@a file · /a command · paste an image)"
            className="bidi block w-full resize-none bg-transparent px-[12px] pt-[9px] pb-[2px] text-[13.5px] outline-none"
            style={{ color: 'var(--text-1)', maxHeight: 150 }}
          />

          <div className="flex items-center justify-between px-[8px] pt-0 pb-[6px]">
            <div className="flex items-center gap-[3px]">
              <button
                type="button"
                className="ctl grid h-[22px] w-[22px] place-items-center rounded-[5px]"
                style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
                onClick={() => fileInput.current?.click()}
                title="Attach a file or image (or paste / drop it)"
                aria-label="Attach a file or image"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9.5 4.5l-4 4a2.1 2.1 0 003 3l4-4a3.2 3.2 0 00-4.5-4.5l-4 4a4.2 4.2 0 006 6l4-4" />
                </svg>
              </button>
              <span className="mx-[3px] h-[10px] w-px" style={{ background: 'var(--line-2)' }} />
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-label={`Set mode to ${m.label}`}
                  aria-pressed={mode === m.id}
                  title={
                    m.id === 'agent'
                      ? 'Agent — reads, writes and runs commands. Writes ask first unless full trust is on.'
                      : m.id === 'plan'
                        ? 'Plan — reads only, then produces a plan you approve. It cannot write.'
                        : 'Ask — conversation only. No tools, no reading, no changes.'
                  }
                  className="ctl rounded-[5px] px-[7px] py-[2px] text-[10.5px]"
                  style={{
                    color: mode === m.id ? 'var(--text-1)' : 'var(--text-4)',
                    border: `1px solid ${mode === m.id ? 'var(--line-3)' : 'transparent'}`,
                    background: mode === m.id ? 'var(--surface)' : 'transparent',
                  }}
                  onClick={() => {
                    sound.play('select')
                    onModeChange(m.id)
                  }}
                >
                  {m.label}
                </button>
              ))}

              <span
                className="mx-[3px] h-[10px] w-px"
                style={{ background: 'var(--line-2)' }}
              />

              {/* The trust switch sits in the toolbar, not buried in settings,
                  because it changes what the very next run will do. */}
              <button
                type="button"
                className="ctl rounded-[5px] px-[7px] py-[2px] text-[10.5px]"
                style={{
                  color: trust === 'auto' ? 'var(--text-1)' : 'var(--text-4)',
                  border: `1px solid ${trust === 'auto' ? 'var(--line-4)' : 'transparent'}`,
                  background:
                    trust === 'auto' ? 'var(--surface)' : 'transparent',
                }}
                onClick={() => {
                  sound.play('select')
                  onToggleTrust()
                }}
                title={
                  trust === 'auto'
                    ? 'Full trust — every write and command runs without asking. Every change is still journaled and can be rewound.'
                    : 'Ask first — the run pauses before each write or command, and shows you exactly what it will do.'
                }
              >
                {trust === 'auto' ? 'Full trust' : 'Ask first'}
              </button>
            </div>

            <div className="flex items-center gap-[10px]">
              <span
                className="mono hidden text-[10.5px] sm:inline"
                style={{ color: 'var(--text-4)' }}
              >
                ⏎ send · ⇧⏎ newline
              </span>

              <motion.button
                type="button"
                className="ctl grid h-[24px] w-[24px] place-items-center rounded-[6px]"
                /* Deliberately NOT `disabled`. The browser's disabled styling
                   snaps the glyph from 35% to full opacity the instant the
                   first character lands, which reads as the icon jumping.
                   The button stays fully drawn; only the glyph colour moves,
                   and .ctl transitions that. */
                aria-disabled={!busy && !canSend}
                style={{
                  border: '1px solid var(--line-3)',
                  background: 'var(--surface)',
                  color: busy || canSend ? 'var(--text-1)' : 'var(--text-4)',
                }}
                onClick={() => {
                  if (busy) {
                    sound.play('select')
                    onStop()
                  } else if (canSend) {
                    submit()
                  }
                }}
                whileTap={{ scale: 0.94 }}
                transition={spring.snap}
                title={busy ? 'Stop' : 'Send'}
                aria-label={busy ? 'Stop' : 'Send'}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={busy ? 'stop' : 'send'}
                    initial={{ opacity: 0, scale: 0.6, rotate: -25 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    exit={{ opacity: 0, scale: 0.6, rotate: 25 }}
                    transition={{ duration: dur.press, ease: easeOut }}
                    style={{ display: 'grid', placeItems: 'center' }}
                  >
                    {busy ? <IconStop size={14} /> : <IconSend size={14} />}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
