import { useState } from 'react'
import { motion } from 'motion/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { api, type ApprovalRequest, type PlanStep, type QuestionRequest } from '../lib/api'
import type { Block } from '../lib/blocks'

/* ===========================================================================
   The transcript.

   The reader's message is right-aligned with one sharp corner; the agent's is
   the page. A tool row is one line while it runs and one line when it finishes.
   An approval card carries the diff and the decision, and it STAYS after it is
   resolved — it is the record that the reader decided.

   No chevrons, no arrows. A row that needs an arrow to say it opens is a row
   that has not been designed; the affordance is the hover state and the cursor.
   =========================================================================== */

export interface TranscriptProps {
  blocks: Block[]
  view: 'normal' | 'thinking' | 'verbose'
  running: boolean
  onDecide: (id: string, approved: boolean) => void
  onAnswer: (id: string, answer: string | null) => void
  onRetry: () => void
}

const STEP_MARK: Record<PlanStep['status'], { fill: boolean; blink: boolean }> = {
  pending: { fill: false, blink: false },
  running: { fill: true, blink: true },
  done: { fill: true, blink: false },
  failed: { fill: true, blink: false },
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mono m-0 mb-[4px] t-tiny tracking-[0.1em] uppercase" style={{ color: 'var(--text-4)' }}>
      {children}
    </p>
  )
}

function Row({
  label,
  right,
  children,
  defaultOpen = false,
}: {
  label: React.ReactNode
  right?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="group">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="ctl flex w-full items-center gap-[8px] rounded-[6px] px-[6px] py-[4px] text-left"
      >
        <span className="min-w-0 flex-1 truncate t-small" style={{ color: 'var(--text-2)' }}>
          {label}
        </span>
        {right && <span className="shrink-0 t-tiny" style={{ color: 'var(--text-4)' }}>{right}</span>}
      </button>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          transition={{ duration: 0.24, ease: [0.65, 0, 0.35, 1] }}
          style={{ overflow: 'hidden' }}
        >
          <div className="px-[6px] pb-[8px]">{children}</div>
        </motion.div>
      )}
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
    <div
      className="rounded-[12px] px-[14px] py-[12px]"
      style={{
        border: `1px solid ${decided === null ? 'var(--line-4)' : 'var(--line-2)'}`,
        background: 'var(--canvas)',
        transition: 'border-color 140ms var(--ease-out)',
      }}
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
        <div className="mt-[10px] flex flex-col gap-[4px]">
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
            className="ctl rounded-[8px] px-[13px] py-[6px] t-small"
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
            className="ctl rounded-[8px] px-[13px] py-[6px] t-small"
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
    </div>
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
      <div className="rounded-[12px] px-[14px] py-[12px]" style={{ border: '1px solid var(--line-2)' }}>
        <Eyebrow>Question</Eyebrow>
        <p className="m-0 t-small" style={{ color: 'var(--text-2)' }}>
          {done === '' ? 'Skipped' : done}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-[12px] px-[14px] py-[12px]" style={{ border: '1px solid var(--line-4)' }}>
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
              className="ctl rounded-[4px] px-[9px] py-[4px] t-small"
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

function PlanBlock({ plan }: { plan: { title?: string; steps: PlanStep[] } }) {
  const done = plan.steps.filter((s) => s.status === 'done').length
  return (
    <div className="rounded-[12px] px-[14px] py-[12px]" style={{ border: '1px solid var(--line-1)' }}>
      <div className="flex items-baseline justify-between">
        <Eyebrow>Plan</Eyebrow>
        <span className="t-tiny" style={{ color: 'var(--text-4)' }}>
          {done}/{plan.steps.length}
        </span>
      </div>
      {plan.title && (
        <p className="m-0 mb-[8px] t-small" style={{ color: 'var(--text-1)' }}>
          {plan.title}
        </p>
      )}
      <ol className="m-0 list-none p-0">
        {plan.steps.map((s, i) => {
          const mark = STEP_MARK[s.status] ?? STEP_MARK.pending
          return (
            <li key={i} className="flex items-start gap-[9px] py-[4px]">
              <span
                className="mt-[6px] h-[6px] w-[6px] shrink-0 rounded-full"
                style={{
                  background: mark.fill ? 'var(--text-1)' : 'transparent',
                  border: mark.fill ? 'none' : '1px solid var(--line-3)',
                  animation: mark.blink ? 'pulse 1.5s ease-in-out infinite' : 'none',
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
}

export function Transcript(p: TranscriptProps) {
  const verbose = p.view === 'verbose'
  const showThinking = p.view === 'thinking' || verbose

  return (
    <div className="flex w-full flex-col gap-[14px] px-[24px] py-[20px]" style={{ maxWidth: 720, margin: '0 auto' }}>
      {p.blocks.map((b) => {
        switch (b.k) {
          case 'user':
            return (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="flex justify-end"
              >
                <div
                  className="rounded-[16px] rounded-br-[4px] px-[14px] py-[10px]"
                  style={{ maxWidth: '70%', background: 'var(--canvas)', border: '1px solid var(--line-2)' }}
                >
                  <Eyebrow>You</Eyebrow>
                  <p className="bidi m-0 t-body leading-[1.62]" style={{ color: 'var(--text-1)' }}>
                    {b.text}
                  </p>
                </div>
              </motion.div>
            )

          case 'text':
            return (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                <Eyebrow>Loong{b.streaming ? ' · working' : ''}</Eyebrow>
                <div className="md bidi" dir="auto" style={{ color: 'var(--text-1)' }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                    {b.text}
                  </ReactMarkdown>
                </div>
              </motion.div>
            )

          case 'thinking':
            if (!showThinking && !verbose) return null
            return (
              <Row
                key={b.id}
                label={
                  <span className="mono">
                    {b.chars.toLocaleString()} chars of thinking
                  </span>
                }
              >
                <p className="bidi m-0 t-small leading-[1.6]" style={{ color: 'var(--text-3)' }}>
                  {b.text}
                </p>
              </Row>
            )

          case 'tool':
            return (
              <Row
                key={b.id}
                label={
                  <span className="mono">
                    {b.wire} {b.live ? <span style={{ color: 'var(--text-4)' }}>· running</span> : null}
                  </span>
                }
                right={
                  <>
                    {b.live ? (
                      <span style={{ color: 'var(--text-1)' }}>·</span>
                    ) : b.ok === false ? (
                      <span>×</span>
                    ) : b.ok ? (
                      <span>✓</span>
                    ) : null}
                    {b.ms ? `${(b.ms / 1000).toFixed(1)}s` : null}
                  </>
                }
                defaultOpen={verbose || b.ok === false}
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
              </Row>
            )

          case 'plan':
            return <PlanBlock key={b.id} plan={b.plan} />

          case 'approval':
            return (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                <ApprovalCard request={b.request} onDecide={p.onDecide} />
              </motion.div>
            )

          case 'question':
            return (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                <QuestionCard request={b.request} onAnswer={p.onAnswer} />
              </motion.div>
            )

          case 'audit':
            return (
              <div key={b.id} className="rounded-[12px] px-[14px] py-[12px]" style={{ border: '1px solid var(--line-1)' }}>
                <Eyebrow>Audit</Eyebrow>
                {(b.audit.findings ?? []).map((f, i) => (
                  <div key={i} className="flex items-baseline gap-[8px] py-[3px]">
                    <span className="t-small" style={{ color: 'var(--text-1)' }}>{f.ok ? '✓' : '×'}</span>
                    <span className="t-small" style={{ color: 'var(--text-2)' }}>{f.label}</span>
                  </div>
                ))}
              </div>
            )

          case 'check':
            return (
              <div key={b.id} className="flex items-baseline gap-[9px] px-[6px] py-[3px]">
                <span className="t-small" style={{ color: 'var(--text-1)' }}>{b.ok ? '✓' : '×'}</span>
                <span className="t-small" style={{ color: 'var(--text-2)' }}>{b.label}</span>
              </div>
            )

          case 'screenshot':
            return (
              <div key={b.id} className="px-[6px]">
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
              <p key={b.id} className="bidi m-0 px-[6px] t-small leading-[1.6]" style={{ color: 'var(--text-2)' }}>
                {b.text}
              </p>
            )

          case 'subagent':
            return (
              <Row
                key={b.id}
                label={<span className="mono">{b.scope || 'subagent'}</span>}
                right={b.phase}
              >
                <p className="bidi m-0 t-small leading-[1.6]" style={{ color: 'var(--text-3)' }}>
                  {b.task}
                  {b.detail ? ` — ${b.detail}` : ''}
                </p>
              </Row>
            )

          case 'failed':
            return (
              <div key={b.id} className="flex flex-col items-start gap-[8px] px-[6px]">
                <p className="bidi m-0 t-small leading-[1.6]" style={{ color: 'var(--text-1)' }}>
                  {b.detail || b.cause}
                </p>
                <button
                  type="button"
                  onClick={p.onRetry}
                  className="ctl rounded-[8px] px-[11px] py-[5px] t-small"
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

      {p.blocks.length === 0 && (
        <div className="px-[6px] py-[40px]">
          <p className="m-0 t-h3" style={{ color: 'var(--text-1)' }}>
            What are we building?
          </p>
          <p className="m-0 mt-[6px] t-small leading-[1.7]" style={{ color: 'var(--text-3)' }}>
            Describe the work and the agent will read the folder, make a plan, and show you every
            change before it lands.
          </p>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.25 } }`}</style>
    </div>
  )
}
