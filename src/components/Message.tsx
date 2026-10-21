import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import type { Block } from '../lib/blocks'
import type { ApprovalDecision } from '../lib/contract'
import { dur, easeOut, enterBlock } from '../motion/tokens'
import { ApprovalCard } from './ApprovalCard'
import { AuditCard } from './AuditCard'
import { Clamped } from './Clamped'
import { Guilloche } from './Guilloche'
import { IconAlert, IconChevron } from './Icons'
import { PlanBlock } from './PlanBlock'
import { QuestionCard } from './QuestionCard'
import { RichText } from './RichText'
import { ToolCard } from './ToolCard'

/* ---------------------------------------------------------------------------
   One block, rendered.

   Text sizes here are in `em`, not px, so the thread text setting in Settings
   scales the prose without touching the tool cards — which must keep their own
   sizes or every card becomes a different shape at a different setting.
   --------------------------------------------------------------------------- */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-[6px] text-[10px] tracking-[0.1em] uppercase"
      style={{ color: 'var(--text-4)' }}
    >
      {children}
    </p>
  )
}

/* ---------------------------------------------------------------------------
   Thinking — collapsible, like every other tool.

   The reasoning is useful when you want it and noise when you don't. It used to
   always be open, pushing the answer down the page; now it is a header with a
   one-line preview, a character count, and a chevron — the same open/close
   grammar as a tool card.
   --------------------------------------------------------------------------- */
function ThinkingBlock({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false)
  const preview = text.replace(/\s+/g, ' ').trim().slice(0, 90)
  return (
    <div
      className="overflow-hidden rounded-[6px]"
      /* flat on the canvas — no sunken box, no border. The reasoning row used
         to read as a terminal strip (dark box + mono text) that appeared and
         vanished with every message; as a quiet line it is information, not an
         alarm. */
      style={{ background: 'transparent' }}
    >
      <button
        type="button"
        className="ctl flex w-full items-center gap-[9px] px-[2px] py-[4px] text-left"
        onClick={() => setOpen((v) => !v)}
        title="Show or hide the reasoning"
        aria-expanded={open}
      >
        <div className="overflow-hidden" style={{ width: 40, height: 11, color: 'var(--guilloche-hot)' }}>
          <Guilloche
            width={80}
            height={11}
            lines={2}
            period={40}
            amplitude={3.2}
            spread={1}
            className={live ? 'guilloche-drift' : undefined}
            style={{ '--drift': '-40px' } as React.CSSProperties}
          />
        </div>
        <span className="mono shrink-0 text-[10.5px]" style={{ color: 'var(--text-4)' }}>
          Thinking
        </span>
        <span className="mono min-w-0 flex-1 truncate text-[10.5px]" style={{ color: 'var(--text-4)' }}>
          {open ? '' : preview}
        </span>
        <span className="mono shrink-0 text-[10px]" style={{ color: 'var(--text-4)' }}>
          {text.length.toLocaleString()} ch
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
            <p
              dir="auto"
              className="bidi m-0 px-[11px] py-[8px] text-[0.9em] leading-[1.6]"
              style={{ color: 'var(--text-3)', borderTop: '1px solid var(--line-1)' }}
            >
              {text}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

interface BlockViewProps {
  block: Block
  onDecide: (id: string, d: ApprovalDecision) => void
  onAnswer: (id: string, answer: string | null) => void
  /** user turns whose run changed files — each maps to the run that undoes it */
  rewindTargets?: Record<string, string>
  onRewind?: (runId: string) => void
}

export function BlockView({ block, onDecide, onAnswer, rewindTargets, onRewind }: BlockViewProps) {
  switch (block.k) {
    case 'user':
      return (
        <motion.div {...enterBlock}>
          <div
            className="rounded-[9px] py-[11px] pr-[13px] pl-[11px]"
            style={{
              /* the reader's voice is a block with an edge; the agent's is the
                 page itself. That is the separation the old cards never had. */
              borderLeft: '2px solid var(--line-5)',
              background: 'var(--surface-raised)',
            }}
          >
            <div className="flex items-center justify-between">
              <Eyebrow>You</Eyebrow>
              {/* a run that changed files is undoable — the button sits on the
                  message that started it, not in a menu somewhere */}
              {rewindTargets?.[block.id] && onRewind && (
                <button
                  type="button"
                  className="ctl rounded-[5px] px-[7px] py-[2px] text-[10.5px]"
                  style={{ border: '1px solid var(--line-2)', color: 'var(--text-4)' }}
                  onClick={() => onRewind(rewindTargets[block.id])}
                  title="Undo everything this run changed — the files go back exactly as they were"
                >
                  ⤺ rewind this run
                </button>
              )}
            </div>
            {block.images && block.images.length > 0 && (
              <div className="mb-[8px] flex flex-wrap gap-[6px]">
                {block.images.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt={`attached image ${i + 1}`}
                    className="max-h-[220px] max-w-full rounded-[6px] object-contain"
                    style={{ border: '1px solid var(--line-2)' }}
                  />
                ))}
              </div>
            )}
            <div
              dir="auto"
              className="bidi text-[1em] leading-[1.62]"
              style={{ color: 'var(--text-1)' }}
            >
              <Clamped text={block.text} id={block.id} />
            </div>
          </div>
        </motion.div>
      )

    case 'thinking':
      return (
        <motion.div {...enterBlock}>
          <ThinkingBlock text={block.text} live={block.live} />
        </motion.div>
      )

    case 'text':
      return (
        <motion.div {...enterBlock}>
          {/* the agent's voice is the page, not a card. A card made the answer
              compete with the tool log for the same visual weight. */}
          <div className="py-[2px] pl-[2px]">
            <Eyebrow>Loong</Eyebrow>
            <div className="text-[1em] leading-[1.68]">
              {block.live ? (
                <>
                  <RichText text={block.text} id={block.id} />
                  <span className="caret" />
                </>
              ) : (
                <Clamped text={block.text} id={block.id} />
              )}
            </div>
          </div>
        </motion.div>
      )

    case 'tool':
      return (
        <motion.div {...enterBlock}>
          <ToolCard call={block.call} result={block.result} />
        </motion.div>
      )

    case 'approval':
      return (
        <motion.div {...enterBlock}>
          <ApprovalCard
            request={block.request}
            decision={block.decision}
            onDecide={(d) => onDecide(block.request.id, d)}
          />
        </motion.div>
      )

    case 'plan':
      return (
        <motion.div {...enterBlock}>
          <PlanBlock plan={block.plan} />
        </motion.div>
      )

    case 'audit':
      return (
        <motion.div {...enterBlock}>
          <AuditCard audit={block.audit} />
        </motion.div>
      )

    case 'question':
      return (
        <motion.div {...enterBlock}>
          <QuestionCard
            request={block.request}
            answer={block.answer}
            onAnswer={onAnswer}
          />
        </motion.div>
      )

    case 'notice':
      return (
        <motion.div {...enterBlock}>
          {/* a hairline, not a card. This is the runtime narrating itself —
              a retry, most often — and it must not compete with the answer. */}
          <div
            className="flex items-baseline gap-[9px] py-[1px] pl-[10px]"
            style={{ borderLeft: '1px solid var(--line-3)' }}
          >
            <span
              className="mono text-[0.83em] leading-[1.55]"
              style={{ color: 'var(--text-4)' }}
            >
              {block.text}
            </span>
          </div>
        </motion.div>
      )

    case 'subagent':
      return (
        <motion.div {...enterBlock}>
          {/* a child agent: one card, open while it reads, settled when its
              findings land on the parent turn */}
          <div
            className="rounded-[9px] px-[13px] py-[10px]"
            style={{
              border: `1px solid ${block.phase === 'start' ? 'var(--line-4)' : 'var(--line-2)'}`,
              background: 'var(--surface-sunken)',
            }}
          >
            <div className="flex items-center gap-[8px]">
              <span
                className="mono text-[10.5px]"
                style={{ color: 'var(--text-4)' }}
              >
                subagent · {block.scope === 'research' ? 'web' : 'codebase'}
              </span>
              {block.phase === 'start' ? (
                <span className="mono text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                  reading…
                </span>
              ) : (
                <span className="mono text-[10.5px]" style={{ color: 'var(--text-4)' }}>
                  reported
                </span>
              )}
            </div>
            <p
              className="mono mt-[6px] mb-0 text-[11.5px] leading-[1.55]"
              style={{ color: 'var(--text-2)' }}
            >
              {block.task}
            </p>
          </div>
        </motion.div>
      )

    case 'screenshot': {
      const name = block.path.split(/[\\/]/).pop() ?? block.path
      const src = `${
        typeof window !== 'undefined' && window.location.protocol === 'file:'
          ? 'http://127.0.0.1:5274'
          : ''
      }/api/shots/${name}`
      return (
        <motion.div {...enterBlock}>
          <a href={src} target="_blank" rel="noreferrer" className="block">
            <img
              src={src}
              alt="screenshot of the page the agent is driving"
              className="block max-h-[320px] w-full rounded-[8px] object-contain object-top"
              style={{ border: '1px solid var(--line-3)' }}
            />
          </a>
          <p className="mono mt-[5px] mb-0 text-[10.5px]" style={{ color: 'var(--text-4)' }}>
            screenshot · {name}
          </p>
        </motion.div>
      )
    }

    case 'error':
      return (
        <motion.div {...enterBlock}>
          <div
            className="rounded-[9px] px-[13px] py-[11px]"
            style={{
              border: '1px solid var(--line-4)',
              background: 'var(--surface-sunken)',
            }}
          >
            <div className="flex items-center gap-[7px]">
              <span style={{ color: 'var(--text-1)' }}>
                <IconAlert size={13} />
              </span>
              <span className="text-[0.926em]" style={{ color: 'var(--text-1)' }}>
                {block.message}
              </span>
            </div>
            {block.detail && (
              <p
                className="mt-[6px] mb-0 text-[0.89em] leading-[1.6]"
                style={{ color: 'var(--text-3)' }}
              >
                {block.detail}
              </p>
            )}
          </div>
        </motion.div>
      )
  }
}
