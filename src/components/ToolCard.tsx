import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import type { ToolCall, ToolResult } from '../lib/contract'
import { dur, easeOut, spring } from '../motion/tokens'
import { sound } from '../lib/sound'
import { IconAlert, IconCheck, IconChevron, TOOL_ICON } from './Icons'

/* ---------------------------------------------------------------------------
   The tool card.

   A tool run is the only place in an agent interface where the machine is doing
   something you cannot see. So the card has exactly three readable states —
   running, ok, failed — and it is the one component allowed to open and close,
   which it does with a layout animation so nothing below it jumps.
   --------------------------------------------------------------------------- */

interface ToolCardProps {
  call: ToolCall
  result?: ToolResult
}

export function ToolCard({ call, result }: ToolCardProps) {
  const [open, setOpen] = useState(false)
  const reduced = useReducedMotion()
  const Icon = TOOL_ICON[call.tool]

  const running = !result
  const failed = result !== undefined && !result.ok
  /* the failure is visible without opening the card: a refused tool whose
     reason lives behind a click is a failure the reader never learns about */
  const failLine = (() => {
    if (!failed || !result) return ''
    const line = (result.output ?? '').split('\n').find((l) => l.trim()) ?? ''
    return line.length > 150 ? `${line.slice(0, 150)}…` : line
  })()

  const statusColor = running
    ? 'var(--text-3)'
    : failed
      ? 'var(--text-1)'
      : 'var(--text-2)'

  return (
    <motion.div
      layout={reduced ? false : 'position'}
      transition={spring.settle}
      className="relative overflow-hidden rounded-[7px]"
      style={{
        border: `1px solid ${failed ? 'var(--line-4)' : 'var(--line-2)'}`,
        background: 'var(--surface-sunken)',
      }}
    >
      <button
        type="button"
        data-tool-card={call.id}
        className="ctl flex w-full items-center gap-[9px] px-[10px] py-[7px] text-left"
        onClick={() => {
          sound.play('select')
          setOpen((v) => !v)
        }}
      >
        <span
          className="grid h-[18px] w-[18px] shrink-0 place-items-center"
          style={{ color: statusColor }}
        >
          {running ? (
            <motion.span
              animate={reduced ? undefined : { rotate: 360 }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
              style={{ display: 'grid', placeItems: 'center' }}
            >
              <Icon size={14} />
            </motion.span>
          ) : (
            <Icon size={14} />
          )}
        </span>

        <span
          className="mono min-w-0 flex-1 truncate text-[11.5px]"
          style={{ color: 'var(--text-2)' }}
        >
          {call.title}
        </span>

        {result && (
          <span
            className="mono shrink-0 text-[10.5px]"
            style={{ color: 'var(--text-4)' }}
          >
            {result.ms < 1000
              ? `${result.ms}ms`
              : `${(result.ms / 1000).toFixed(1)}s`}
          </span>
        )}

        <span
          className="grid h-[16px] w-[16px] shrink-0 place-items-center"
          style={{ color: failed ? 'var(--text-1)' : 'var(--text-4)' }}
        >
          {running ? null : failed ? (
            <IconAlert size={13} />
          ) : (
            <IconCheck size={13} />
          )}
        </span>

        <motion.span
          className="grid h-[16px] w-[16px] shrink-0 place-items-center"
          style={{ color: 'var(--text-4)' }}
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: dur.hover, ease: easeOut }}
        >
          <IconChevron size={13} />
        </motion.span>
      </button>

      {/* the reason a tool failed, on the card itself — not behind a click.
          a refused write whose error is invisible is how a run "succeeds"
          while nothing landed. */}
      {failed && failLine && !open && (
        <div
          className="mono truncate px-[10px] pb-[7px] text-[10.5px]"
          style={{ color: 'var(--text-3)' }}
          title={failLine}
        >
          {failLine}
        </div>
      )}

      {/* a single hairline that sweeps while the tool is out. no spinner, no
          skeleton, no shimmer — one line, moving. */}
      {running && (
        <div
          className="relative h-[1px] w-full overflow-hidden"
          style={{ background: 'var(--line-1)' }}
        >
          <motion.div
            className="absolute inset-y-0 w-[34%]"
            style={{ background: 'var(--line-5)' }}
            animate={reduced ? { left: '33%' } : { left: ['-34%', '100%'] }}
            transition={{ duration: 1.35, repeat: Infinity, ease: easeOut }}
          />
        </div>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: dur.panel, ease: easeOut }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ borderTop: '1px solid var(--line-1)' }}>
              <Field label={call.tool === 'shell' ? 'command' : 'input'}>
                {Object.entries(call.input)
                  .map(([k, v]) => `${k}: ${String(v)}`)
                  .join('\n')}
              </Field>
              {result && (
                <Field
                  label={result.ok ? 'output' : 'failed'}
                  last
                  clamp
                  tone={result.ok ? 'normal' : 'strong'}
                >
                  {result.output}
                </Field>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* a file read or a test log can be enormous, and a tool card that mounts fifty
   thousand lines to show four is the single easiest way to make this app feel
   slow. The string is sliced before it ever reaches the DOM. */
const OUTPUT_CLAMP = 1200

function Field({
  label,
  children,
  last,
  tone = 'normal',
  clamp = false,
}: {
  label: string
  children: React.ReactNode
  last?: boolean
  tone?: 'normal' | 'strong'
  clamp?: boolean
}) {
  const [open, setOpen] = useState(false)
  const text = typeof children === 'string' ? children : null
  const long = clamp && text !== null && text.length > OUTPUT_CLAMP
  const shown = long && !open ? text.slice(0, OUTPUT_CLAMP) : children

  return (
    <div
      className="px-[11px] py-[8px]"
      style={last ? undefined : { borderBottom: '1px solid var(--line-1)' }}
    >
      <div className="mb-[5px] flex items-center gap-[8px]">
        <p
          className="m-0 text-[10px] tracking-[0.08em] uppercase"
          style={{ color: 'var(--text-4)' }}
        >
          {label}
        </p>
        {long && (
          <span className="mono text-[10px]" style={{ color: 'var(--text-4)' }}>
            {text.length.toLocaleString()} chars
          </span>
        )}
      </div>

      <div
        style={
          long && !open
            ? {
                maskImage:
                  'linear-gradient(to bottom, #000 50%, transparent 100%)',
                WebkitMaskImage:
                  'linear-gradient(to bottom, #000 50%, transparent 100%)',
              }
            : undefined
        }
      >
        <pre
          dir="auto"
          className="bidi mono m-0 text-[11.5px] leading-[1.62] whitespace-pre-wrap"
          style={{
            color: tone === 'strong' ? 'var(--text-1)' : 'var(--text-3)',
          }}
        >
          {shown}
        </pre>
      </div>

      {long && (
        <button
          type="button"
          className="ctl mt-[8px] rounded-[5px] px-[9px] py-[3px] text-[11px]"
          style={{
            border: '1px solid var(--line-2)',
            color: 'var(--text-2)',
          }}
          onClick={() => {
            sound.play('select')
            setOpen((v) => !v)
          }}
        >
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  )
}
