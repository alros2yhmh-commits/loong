import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { api, type ApprovalRequest, type PlanStep, type QuestionRequest } from '../lib/api'
import type { Block } from '../lib/blocks'
import { Creature } from './Mark'

/* ===========================================================================
   The transcript.

   The reader's message is right-aligned with one sharp corner; the agent's is
   the page. A tool row is one line while it runs and one line when it
   finishes. An approval card carries the diff and STAYS resolved — it is the
   record that the reader decided.

   No chevrons and no arrows. A row that needs an arrow to say it opens is a
   row that has not been designed; the affordance is the hover state.
   =========================================================================== */

export interface TranscriptProps {
  blocks: Block[]
  view: 'normal' | 'thinking' | 'verbose'
  running: boolean
  onDecide: (id: string, approved: boolean) => void
  onAnswer: (id: string, answer: string | null) => void
  onRetry: () => void
  /** when the shell draws the empty state, the transcript does not */
  bare?: boolean
}

const STEP: Record<PlanStep['status'], { fill: boolean; live: boolean }> = {
  pending: { fill: false, live: false },
  running: { fill: true, live: true },
  done: { fill: true, live: false },
  failed: { fill: true, live: false },
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mono m-0 mb-[5px] t-tiny tracking-[0.1em] uppercase" style={{ color: 'var(--text-4)' }}>
      {children}
    </p>
  )
}

function Fold({
  label,
  right,
  children,
  open: controlled,
}: {
  label: React.ReactNode
  right?: React.ReactNode
  children: React.ReactNode
  open?: boolean
}) {
  /* `open` is the STARTING state. The row always toggles, because a row that
     looks like it opens and cannot is the worst kind of dead control. */
  const [open, setOpen] = useState(controlled ?? false)
  return (
    <div className="group">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="ctl flex w-full items-center gap-[8px] rounded-[7px] px-[7px] py-[5px] text-left"
      >
        <span className="min-w-0 flex-1 truncate t-small" style={{ color: 'var(--text-2)' }}>
          {label}
        </span>
        {right && (
          <span className="shrink-0 t-tiny" style={{ color: 'var(--text-4)' }}>
            {right}
          </span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.65, 0, 0.35, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-[7px] pb-[9px] pt-[2px]">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ApprovalCard({
  request,
  onDecide,
}: {
  request: ApprovalRequest
  onDecide: (id: string, approved: boolean) => void
}) {
  const [decided, setDecided] = useState<boolean | null>(null)
  const files = Array.isArray(request.files) ? request.files : []

  return (
    <motion.div
      initial={false}
      animate={{ borderColor: decided === null ? 'var(--line-4)' : 'var(--line-2)' }}
      transition={{ duration: 0.14 }}
      className="rounded-[12px] px-[15px] py-[13px]"
      style={{ border: '1px solid var(--line-4)', background: 'var(--canvas)' }}
    >
      <Eyebrow>Approval</Eyebrow>
      <p className="m-0 t-small" style={{ color: 'var(--text-1)' }}>
        {request.title || request.tool}
      </p>
      {request.detail && (
        <p className="m-0 mt-[4px] t-small leading-[1.6]" style={{ color: 'var(--text-3)' }}>
          {request.detail}
        </p>
      )}

      {files.length > 0 && (
        <div className="mt-[10px] flex flex-col gap-[3px]">
          {files.slice(0, 12).map((f, i) => {
            const path = typeof f === 'string' ? f : String((f as { path?: string }).path ?? `file ${i + 1}`)
            return (
              <div key={i} className="mono t-code" style={{ color: 'var(--text-2)' }}>
                {path}
              </div>
            )
          })}
        </div>
      )}

      {decided === null ? (
        <div className="mt-[12px] flex items-center gap-[8px]">
          <button
            type="button"
            className="ctl rounded-[8px] px-[14px] py-[6px] t-small"
            style={{ background: 'var(--btn-primary)', color: 'var(--btn-primary-text)' }}
            onClick={() => {
              setDecided(true)
              onDecide(request.id, true)
            }}
          >
            Approve
          </button>
          <button
            type="button"
            className="ctl rounded-[8px] px-[14px] py-[6px] t-small"
            style={{ border: '1px solid var(--line-2)', color: 'var(--text-1)' }}
            onClick={() => {
              setDecided(false)
              onDecide(request.id, false)
            }}
          >
            Decline
          </button>
        </div>
      ) : (
        <p className="m-0 mt-[10px] t-small" style={{ color: 'var(--text-3)' }}>
          {decided ? 'Approved' : 'Declined'}
        </p>
      )}
    </motion.div>
  )
}

function QuestionCard({
  request,
  onAnswer,
}: {
  request: QuestionRequest
  onAnswer: (id: string, answer: string | null) => void
}) {
  const [text, setText] = useState('')
  const [done, setDone] = useState<string | null>(null)

  if (done !== null) {
    return (
      <div className="rounded-[12px] px-[15px] py-[13px]" style={{ border: '1px solid var(--line-2)' }}>
        <Eyebrow>Question</Eyebrow>
        <p className="m-0 t-small" style={{ color: 'var(--text-2)' }}>
          {done === '' ? 'Skipped' : done}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-[12px] px-[15px] py-[13px]" style={{ border: '1px solid var(--line-4)' }}>
      <Eyebrow>Question</Eyebrow>
      <p className="m-0 t-small" style={{ color: 'var(--text-1)' }}>
        {request.question}
      </p>
      {request.detail && (
        <p className="m-0 mt-[4px] t-small" style={{ color: 'var(--text-3)' }}>
          {request.detail}
        </p>
      )}
      {request.options && request.options.length > 0 && (
        <div className="mt-[10px] flex flex-wrap gap-[6px]">
          {request.options.map((o) => (
            <button
              key={o}
              type="button"
              className="ctl rounded-[6px] px-[10px] py-[5px] t-small"
              style={{ border: '1px solid var(--line-2)', color: 'var(--text-1)' }}
              onClick={() => {
                setDone(o)
                onAnswer(request.id, o)
              }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
      <div className="mt-[10px] flex items-center gap-[8px]">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              setDone(text.trim())
              onAnswer(request.id, text.trim())
            }
          }}
          placeholder="Answer, or skip…"
          aria-label="Answer"
          className="min-w-0 flex-1 rounded-[8px] px-[10px] py-[6px] t-small outline-none"
          style={{ border: '1px solid var(--line-2)' }}
        />
        <button
          type="button"
          className="ctl rounded-[8px] px-[11px] py-[6px] t-small"
          style={{ color: 'var(--text-3)' }}
          onClick={() => {
            setDone('')
            onAnswer(request.id, null)
          }}
        >
          Skip
        </button>
      </div>
    </div>
  )
}

/** the creature and the one question, for the shell's centred arrangement */
export function EmptyState({ running }: { running: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center"
    >
      <Creature size={104} mood={running ? 'working' : 'idle'} />
      <p className="display mt-[16px] t-h1" style={{ color: 'var(--text-1)' }}>
        What are we building?
      </p>
      <p className="mt-[7px] mb-0 max-w-[430px] text-center t-small leading-[1.7]" style={{ color: 'var(--text-3)' }}>
        Describe the work. The agent reads the folder, makes a plan, and shows you every change
        before it lands.
      </p>
    </motion.div>
  )
}

export function Transcript(p: TranscriptProps) {
  const verbose = p.view === 'verbose'
  const showThinking = p.view === 'thinking' || verbose
  const last = p.blocks[p.blocks.length - 1]

  return (
    <div
      className="mx-auto flex w-full flex-col gap-[16px] px-[24px] py-[22px]"
      style={{ maxWidth: 'var(--thread-measure)' }}
    >
      {p.blocks.map((b) => {
        switch (b.k) {
          case 'user':
            return (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="flex justify-end"
              >
                <div
                  className="rounded-[18px] rounded-br-[5px] px-[15px] py-[10px]"
                  style={{
                    maxWidth: '74%',
                    background: 'var(--canvas)',
                    border: '1px solid var(--line-2)',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                  }}
                >
                  <p className="bidi m-0 t-body leading-[1.6]" style={{ color: 'var(--text-1)' }}>
                    {b.text}
                  </p>
                </div>
              </motion.div>
            )

          case 'text':
            return (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <Eyebrow>{b.streaming ? 'Loong · working' : 'Loong'}</Eyebrow>
                <div className="md bidi" dir="auto" style={{ color: 'var(--text-1)' }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                    {b.text}
                  </ReactMarkdown>
                  {b.streaming && <span className="caret" aria-hidden />}
                </div>
              </motion.div>
            )

          case 'thinking':
            if (!showThinking) return null
            return (
              <Fold
                key={b.id}
                label={<span className="mono">{b.chars.toLocaleString()} chars of thinking</span>}
              >
                <p className="bidi m-0 t-small leading-[1.65]" style={{ color: 'var(--text-3)' }}>
                  {b.text}
                </p>
              </Fold>
            )

          case 'tool':
            return (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: 4, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                style={{ overflow: 'hidden' }}
              >
              <Fold
                key={b.id}
                label={
                  <span className="mono">
                    {b.wire}
                    {b.live && (
                      <span className="shimmer" style={{ color: 'var(--text-4)' }}>
                        {' '}
                        · running
                      </span>
                    )}
                  </span>
                }
                right={
                  <>
                    {b.ok === false ? '×' : b.ok ? '✓' : null}
                    {b.ms ? ` ${(b.ms / 1000).toFixed(1)}s` : ''}
                  </>
                }
                open={verbose || b.ok === false}
              >
                <div className="flex flex-col gap-[8px]">
                  {b.args && (
                    <pre className="mono m-0 overflow-x-auto t-code" style={{ color: 'var(--text-3)' }}>
                      {b.args.length > 1200 ? `${b.args.slice(0, 1200)}…` : b.args}
                    </pre>
                  )}
                  {b.result && (
                    <pre className="mono m-0 overflow-x-auto t-code" style={{ color: 'var(--text-2)' }}>
                      {b.result.length > 4000 ? `${b.result.slice(0, 4000)}…` : b.result}
                    </pre>
                  )}
                </div>
              </Fold>
              </motion.div>
            )

          case 'plan':
            return (
              <div key={b.id} className="rounded-[12px] px-[15px] py-[13px]" style={{ border: '1px solid var(--line-1)' }}>
                <div className="flex items-baseline justify-between">
                  <Eyebrow>Plan</Eyebrow>
                  <span className="t-tiny" style={{ color: 'var(--text-4)' }}>
                    {b.plan.steps.filter((s) => s.status === 'done').length}/{b.plan.steps.length}
                  </span>
                </div>
                {b.plan.title && (
                  <p className="m-0 mb-[8px] t-small" style={{ color: 'var(--text-1)' }}>
                    {b.plan.title}
                  </p>
                )}
                <ol className="m-0 list-none p-0">
                  {b.plan.steps.map((s, i) => {
                    const mark = STEP[s.status] ?? STEP.pending
                    return (
                      <li key={i} className="flex items-start gap-[9px] py-[4px]">
                        <span
                          className={`mt-[6px] h-[6px] w-[6px] shrink-0 rounded-full ${mark.live ? 'pulse-dot' : ''}`}
                          style={{
                            background: mark.fill ? 'var(--text-1)' : 'transparent',
                            border: mark.fill ? 'none' : '1px solid var(--line-3)',
                          }}
                        />
                        <span className="t-small" style={{ color: 'var(--text-2)' }}>
                          {s.title}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              </div>
            )

          case 'approval':
            return <ApprovalCard key={b.id} request={b.request} onDecide={p.onDecide} />

          case 'question':
            return <QuestionCard key={b.id} request={b.request} onAnswer={p.onAnswer} />

          case 'audit':
            return (
              <div key={b.id} className="rounded-[12px] px-[15px] py-[13px]" style={{ border: '1px solid var(--line-1)' }}>
                <Eyebrow>Audit</Eyebrow>
                {(b.audit.findings ?? []).map((f, i) => (
                  <div key={i} className="flex items-baseline gap-[8px] py-[3px]">
                    <span className="t-small" style={{ color: 'var(--text-1)' }}>
                      {f.ok ? '✓' : '×'}
                    </span>
                    <span className="t-small" style={{ color: 'var(--text-2)' }}>
                      {f.label}
                    </span>
                  </div>
                ))}
              </div>
            )

          case 'check':
            return (
              <div key={b.id} className="flex items-baseline gap-[9px] px-[7px] py-[2px]">
                <span className="t-small" style={{ color: 'var(--text-1)' }}>
                  {b.ok ? '✓' : '×'}
                </span>
                <span className="t-small" style={{ color: 'var(--text-2)' }}>
                  {b.label}
                </span>
              </div>
            )

          case 'screenshot':
            return (
              <div key={b.id} className="px-[7px]">
                <img
                  src={api.shotUrl(b.path)}
                  alt={`A screenshot taken by ${b.tool}`}
                  className="max-w-full rounded-[12px]"
                  style={{ border: '1px solid var(--line-1)' }}
                />
              </div>
            )

          case 'notice':
            return (
              <p key={b.id} className="bidi m-0 px-[7px] t-small leading-[1.6]" style={{ color: 'var(--text-2)' }}>
                {b.text}
              </p>
            )

          case 'subagent':
            return (
              <Fold key={b.id} label={<span className="mono">{b.scope || 'subagent'}</span>} right={b.phase}>
                <p className="bidi m-0 t-small leading-[1.6]" style={{ color: 'var(--text-3)' }}>
                  {b.task}
                  {b.detail ? ` — ${b.detail}` : ''}
                </p>
              </Fold>
            )

          case 'failed':
            return (
              <div key={b.id} className="flex flex-col items-start gap-[8px] px-[7px]">
                <p className="bidi m-0 t-small leading-[1.6]" style={{ color: 'var(--text-1)' }}>
                  {b.detail || b.cause}
                </p>
                <button
                  type="button"
                  onClick={p.onRetry}
                  className="ctl rounded-[8px] px-[12px] py-[5px] t-small"
                  style={{ border: '1px solid var(--line-3)', color: 'var(--text-1)' }}
                >
                  Retry
                </button>
              </div>
            )

          default:
            return null
        }
      })}

      {/* the empty state: the creature, then the one question that matters.
          The shell draws it when it needs to wrap the composer with it. */}
      {p.blocks.length === 0 && !p.bare && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col items-center pb-[8px] pt-[6vh]"
        >
          <Creature size={104} mood={p.running ? 'working' : 'idle'} />
          <p className="display mt-[14px] t-h1" style={{ color: 'var(--text-1)' }}>
            What are we building?
          </p>
          <p className="mt-[6px] mb-0 max-w-[420px] text-center t-small leading-[1.7]" style={{ color: 'var(--text-3)' }}>
            Describe the work. The agent reads the folder, makes a plan, and shows you every change
            before it lands.
          </p>
        </motion.div>
      )}

      {/* the working tail: the creature, small, while the run is alive */}
      {p.running && last && last.k !== 'text' && (
        <div className="flex items-center gap-[9px] px-[7px]">
          <Creature size={26} mood="working" />
          <span className="t-tiny shimmer" style={{ color: 'var(--text-3)' }}>
            working
          </span>
        </div>
      )}
    </div>
  )
}
