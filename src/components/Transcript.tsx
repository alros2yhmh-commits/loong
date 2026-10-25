import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { api, type ApprovalRequest, type Plan, type PlanStep, type QuestionRequest, type Audit } from '../lib/api'
import { splitToolCalls, type Block } from '../lib/blocks'
import { Dragon, Working } from './Dragon'
import { t, e, rise, card, collapse, stagger } from '../lib/motion'

/* ===========================================================================
   The transcript, and the activity timeline inside it.

   The agent's work is a SEQUENCE, and a sequence wants a rail. Every tool call
   is a node on a vertical line with its own state, its own duration and its own
   expandable output — so a long run reads as a route, not as a wall of text.

   A plan is a card with the task, a progress bar and numbered steps, because a
   plan is the thing you glance at to answer "how far along is this".

   No chevrons and no arrows. The rail IS the structure; a row that needs an
   arrow to say it opens has not been designed.
   =========================================================================== */

export interface TranscriptProps {
  blocks: Block[]
  view: 'normal' | 'thinking' | 'verbose'
  running: boolean
  onDecide: (id: string, approved: boolean) => void
  onAnswer: (id: string, answer: string | null) => void
  onRetry: () => void
  bare?: boolean
}

/* ---- the rail node ------------------------------------------------------- */

type NodeState = 'pending' | 'live' | 'done' | 'failed'

function Node({ state }: { state: NodeState }) {
  const colour =
    state === 'failed'
      ? 'var(--fail)'
      : state === 'live'
        ? 'var(--amber)'
        : state === 'done'
          ? 'var(--text-2)'
          : 'var(--line-3)'
  return (
    <span className="relative grid h-[18px] w-[18px] shrink-0 place-items-center">
      {state === 'live' && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ background: 'var(--amber-dim)' }}
          animate={{ opacity: [0.35, 0.9, 0.35] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <span
        className="relative rounded-full"
        style={{
          width: state === 'done' || state === 'failed' ? 7 : 6,
          height: state === 'done' || state === 'failed' ? 7 : 6,
          background: state === 'done' || state === 'failed' ? colour : 'transparent',
          border: state === 'done' || state === 'failed' ? 'none' : `1.5px solid ${colour}`,
        }}
      />
    </span>
  )
}

/* ---- a row on the rail --------------------------------------------------- */

function RailRow({
  state,
  label,
  meta,
  children,
  startOpen = false,
}: {
  state: NodeState
  label: React.ReactNode
  meta?: React.ReactNode
  children?: React.ReactNode
  startOpen?: boolean
}) {
  const [open, setOpen] = useState(startOpen)
  const canOpen = Boolean(children)
  return (
    <motion.div variants={rise} className="relative pl-[26px]">
      {/* the rail itself, drawn per row so it never overhangs the ends */}
      <span
        className="absolute left-[8px] top-[18px] bottom-0 w-px"
        style={{ background: 'var(--line-1)' }}
        aria-hidden
      />
      <span className="absolute left-0 top-0">
        <Node state={state} />
      </span>

      <button
        type="button"
        onClick={() => canOpen && setOpen((v) => !v)}
        aria-expanded={canOpen ? open : undefined}
        className={`flex w-full items-start gap-[8px] rounded-[6px] px-[6px] py-[4px] text-left ${
          canOpen ? 'ctl' : ''
        }`}
        style={{ cursor: canOpen ? 'pointer' : 'default' }}
      >
        <span className="min-w-0 flex-1 truncate t-small" style={{ color: 'var(--text-2)' }}>
          {label}
        </span>
        {meta && (
          <span className="mono shrink-0 t-tiny" style={{ color: 'var(--text-3)' }}>
            {meta}
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && children && (
          <motion.div
            variants={collapse}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ overflow: 'hidden' }}
          >
            <div className="px-[6px] pb-[8px] pt-[2px]">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function Code({ text, tone = 3, max = 2400 }: { text: string; tone?: 2 | 3; max?: number }) {
  return (
    <pre
      className="mono m-0 overflow-x-auto rounded-[7px] px-[10px] py-[8px] t-code"
      style={{
        background: 'var(--canvas)',
        border: '1px solid var(--line-1)',
        color: tone === 2 ? 'var(--text-2)' : 'var(--text-3)',
        maxHeight: 320,
        overflowY: 'auto',
      }}
    >
      {text.length > max ? `${text.slice(0, max)}\n…` : text}
    </pre>
  )
}

/* ---- the plan ------------------------------------------------------------ */

const STEP_TONE: Record<PlanStep['status'], { node: NodeState; text: string }> = {
  pending: { node: 'pending', text: 'var(--text-3)' },
  in_progress: { node: 'live', text: 'var(--text-1)' },
  done: { node: 'done', text: 'var(--text-2)' },
  blocked: { node: 'failed', text: 'var(--text-2)' },
}

function PlanCard({ plan }: { plan: Plan }) {
  const steps = plan.steps ?? []
  const done = steps.filter((s) => s.status === 'done').length
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0
  const live = steps.some((s) => s.status === 'in_progress')

  return (
    <motion.div
      variants={card}
      className="overflow-hidden rounded-[12px]"
      style={{ background: 'var(--raised)', border: '1px solid var(--line-2)' }}
    >
      <div className="flex items-start gap-[10px] px-[14px] pt-[12px] pb-[10px]">
        <div className="min-w-0 flex-1">
          <p className="mono m-0 mb-[3px] t-tiny tracking-[0.14em] uppercase" style={{ color: 'var(--text-3)' }}>
            Plan
          </p>
          <p className="bidi m-0 t-small leading-[1.55]" style={{ color: 'var(--text-1)' }}>
            {plan.task || 'Working through the task'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className="mono t-tiny" style={{ color: live ? 'var(--amber)' : 'var(--text-3)' }}>
            {done}/{steps.length}
          </span>
        </div>
      </div>

      {/* the progress bar: a real fraction of the real steps */}
      <div className="px-[14px]">
        <div className="h-[3px] w-full overflow-hidden rounded-full" style={{ background: 'var(--line-1)' }}>
          <motion.div
            className="h-full rounded-full"
            style={{ background: live ? 'var(--amber)' : 'var(--text-2)' }}
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ duration: t.slow, ease: e.out }}
          />
        </div>
      </div>

      <ol className="m-0 list-none px-[14px] pt-[10px] pb-[12px]">
        {steps.map((s, i) => {
          const tone = STEP_TONE[s.status] ?? STEP_TONE.pending
          return (
            <motion.li
              key={`${i}-${s.description}`}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: t.base, delay: i * 0.025, ease: e.out }}
              className="flex items-start gap-[9px] py-[3px]"
            >
              <span className="mono mt-[2px] w-[13px] shrink-0 t-tiny" style={{ color: 'var(--text-3)' }}>
                {s.status === 'done' ? '✓' : s.status === 'in_progress' ? '▸' : s.status === 'blocked' ? '×' : i + 1}
              </span>
              <span
                className="bidi min-w-0 flex-1 t-small leading-[1.55]"
                style={{
                  color: tone.text,
                  textDecoration: s.status === 'done' ? 'none' : 'none',
                  opacity: s.status === 'pending' ? 0.72 : 1,
                }}
              >
                {s.description || `Step ${i + 1}`}
              </span>
              {s.status === 'in_progress' && (
                <span className="mt-[3px] shrink-0">
                  <Working label="" />
                </span>
              )}
            </motion.li>
          )
        })}
      </ol>

      {(plan.reference || (plan.doneWhen && plan.doneWhen.length > 0)) && (
        <div className="px-[14px] pb-[12px] pt-[2px]" style={{ borderTop: '1px solid var(--line-1)' }}>
          {plan.reference && (
            <p className="bidi m-0 mt-[8px] t-tiny leading-[1.5]" style={{ color: 'var(--text-3)' }}>
              <span className="mono uppercase tracking-[0.1em]">Reference</span> · {plan.reference}
            </p>
          )}
          {plan.doneWhen && plan.doneWhen.length > 0 && (
            <div className="mt-[6px]">
              <span className="mono t-tiny uppercase tracking-[0.1em]" style={{ color: 'var(--text-3)' }}>
                Done when
              </span>
              <ul className="m-0 mt-[2px] list-none p-0">
                {plan.doneWhen.map((c, i) => (
                  <li key={i} className="bidi t-tiny leading-[1.55]" style={{ color: 'var(--text-3)' }}>
                    · {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </motion.div>
  )
}

/* ---- approvals ----------------------------------------------------------- */

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
      variants={card}
      initial={false}
      animate={{ borderColor: decided === null ? 'var(--amber-line)' : 'var(--line-2)' }}
      transition={{ duration: t.fast }}
      className="overflow-hidden rounded-[12px]"
      style={{ background: 'var(--raised)', border: '1px solid var(--amber-line)' }}
    >
      <div
        className="flex items-center gap-[8px] px-[14px] py-[9px]"
        style={{ background: decided === null ? 'var(--amber-dim)' : 'transparent', borderBottom: '1px solid var(--line-1)' }}
      >
        <span style={{ color: 'var(--amber)' }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 2.4l4.6 2.2v3.6c0 2.8-1.9 4.9-4.6 5.8-2.7-.9-4.6-3-4.6-5.8V4.6L8 2.4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="mono flex-1 t-tiny tracking-[0.12em] uppercase" style={{ color: 'var(--text-2)' }}>
          Needs approval
        </span>
        <span className="mono t-tiny" style={{ color: 'var(--text-3)' }}>
          {request.tool}
        </span>
      </div>

      <div className="px-[14px] py-[11px]">
        <p className="bidi m-0 t-small leading-[1.55]" style={{ color: 'var(--text-1)' }}>
          {request.title || request.tool}
        </p>
        {request.detail && (
          <p className="bidi m-0 mt-[4px] t-small leading-[1.6]" style={{ color: 'var(--text-3)' }}>
            {request.detail}
          </p>
        )}

        {files.length > 0 && (
          <div className="mt-[9px] flex flex-col gap-[2px]">
            {files.slice(0, 14).map((f, i) => {
              const path = typeof f === 'string' ? f : String((f as { path?: string }).path ?? `file ${i + 1}`)
              return (
                <div key={i} className="mono truncate t-code" style={{ color: 'var(--text-2)' }}>
                  {path}
                </div>
              )
            })}
            {files.length > 14 && (
              <div className="mono t-tiny" style={{ color: 'var(--text-3)' }}>
                +{files.length - 14} more
              </div>
            )}
          </div>
        )}

        {decided === null ? (
          <div className="mt-[12px] flex items-center gap-[7px]">
            <button
              type="button"
              className="ctl rounded-[7px] px-[14px] py-[6px] t-small"
              style={{ background: 'var(--btn)', color: 'var(--btn-text)' }}
              onClick={() => {
                setDecided(true)
                onDecide(request.id, true)
              }}
            >
              Approve
            </button>
            <button
              type="button"
              className="ctl rounded-[7px] px-[14px] py-[6px] t-small"
              style={{ border: '1px solid var(--line-3)', color: 'var(--text-2)' }}
              onClick={() => {
                setDecided(false)
                onDecide(request.id, false)
              }}
            >
              Decline
            </button>
            <span className="flex-1" />
            <span className="t-tiny" style={{ color: 'var(--text-3)' }}>
              the run is parked until you decide
            </span>
          </div>
        ) : (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="m-0 mt-[10px] t-small"
            style={{ color: decided ? 'var(--ok)' : 'var(--text-3)' }}
          >
            {decided ? 'Approved' : 'Declined'}
          </motion.p>
        )}
      </div>
    </motion.div>
  )
}

/* ---- questions ----------------------------------------------------------- */

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
      <div className="rounded-[12px] px-[14px] py-[11px]" style={{ border: '1px solid var(--line-2)', background: 'var(--raised)' }}>
        <p className="mono m-0 mb-[3px] t-tiny uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>
          Answer
        </p>
        <p className="bidi m-0 t-small" style={{ color: 'var(--text-2)' }}>
          {done === '' ? 'Skipped' : done}
        </p>
      </div>
    )
  }

  return (
    <motion.div
      variants={card}
      className="rounded-[12px] px-[14px] py-[11px]"
      style={{ border: '1px solid var(--amber-line)', background: 'var(--raised)' }}
    >
      <p className="mono m-0 mb-[4px] t-tiny uppercase tracking-[0.12em]" style={{ color: 'var(--amber)' }}>
        Question
      </p>
      <p className="bidi m-0 t-small leading-[1.55]" style={{ color: 'var(--text-1)' }}>
        {request.question}
      </p>
      {request.detail && (
        <p className="bidi m-0 mt-[4px] t-small" style={{ color: 'var(--text-3)' }}>
          {request.detail}
        </p>
      )}
      {request.options && request.options.length > 0 && (
        <div className="mt-[9px] flex flex-wrap gap-[5px]">
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
      <div className="mt-[9px] flex items-center gap-[7px]">
        <input
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' && text.trim()) {
              setDone(text.trim())
              onAnswer(request.id, text.trim())
            }
          }}
          placeholder="Type an answer…"
          aria-label="Answer"
          className="min-w-0 flex-1 rounded-[7px] px-[10px] py-[6px] t-small outline-none"
          style={{ background: 'var(--canvas)', border: '1px solid var(--line-2)' }}
        />
        <button
          type="button"
          className="ctl rounded-[7px] px-[10px] py-[6px] t-small"
          style={{ color: 'var(--text-3)' }}
          onClick={() => {
            setDone('')
            onAnswer(request.id, null)
          }}
        >
          Skip
        </button>
      </div>
    </motion.div>
  )
}

/* ---- the audit ----------------------------------------------------------- */

function AuditCard({ audit }: { audit: Audit }) {
  const tone =
    audit.verdict === 'met' ? 'var(--ok)' : audit.verdict === 'partial' ? 'var(--amber)' : 'var(--fail)'
  return (
    <motion.div variants={card} className="rounded-[12px] px-[14px] py-[11px]" style={{ border: '1px solid var(--line-2)', background: 'var(--raised)' }}>
      <div className="flex items-center gap-[8px]">
        <p className="mono m-0 t-tiny uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>
          Audit
        </p>
        <span className="mono t-tiny" style={{ color: tone }}>
          {audit.verdict.replace('_', ' ')}
        </span>
      </div>
      <ul className="m-0 mt-[6px] list-none p-0">
        {(audit.items ?? []).map((it, i) => (
          <li key={i} className="flex items-start gap-[8px] py-[3px]">
            <span className="mt-[1px] shrink-0 t-small" style={{ color: it.met ? 'var(--ok)' : 'var(--fail)' }}>
              {it.met ? '✓' : '×'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="bidi block t-small" style={{ color: 'var(--text-2)' }}>
                {it.criterion}
              </span>
              {it.evidence && (
                <span className="bidi block t-tiny leading-[1.5]" style={{ color: 'var(--text-3)' }}>
                  {it.evidence}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </motion.div>
  )
}

/* ---- the empty state ----------------------------------------------------- */

export function EmptyState({ running }: { running: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: t.slow, ease: e.out }}
      className="flex flex-col items-center"
    >
      <Dragon size={92} mood={running ? 'working' : 'idle'} />
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08, duration: t.slow }}
        className="display mt-[14px] t-h1"
        style={{ color: 'var(--text-1)' }}
      >
        What are we building?
      </motion.p>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.14, duration: t.slow }}
        className="mt-[6px] mb-0 max-w-[420px] text-center t-small leading-[1.65]"
        style={{ color: 'var(--text-3)' }}
      >
        Describe the work. The agent reads the folder, makes a plan, and shows you every change
        before it lands.
      </motion.p>
    </motion.div>
  )
}

/* ---- the transcript ------------------------------------------------------ */

export function Transcript(p: TranscriptProps) {
  const verbose = p.view === 'verbose'
  const showThinking = p.view === 'thinking' || verbose
  const last = p.blocks[p.blocks.length - 1]

  return (
    <div
      className="mx-auto flex w-full flex-col gap-[14px] px-[28px] py-[20px]"
      style={{ maxWidth: 'var(--thread-measure)' }}
    >
      {p.blocks.map((b) => {
        switch (b.k) {
          case 'user':
            return (
              <motion.div key={b.id} variants={rise} initial="initial" animate="animate" className="flex justify-end">
                <div
                  className="max-w-[78%] rounded-[12px] rounded-br-[4px] px-[13px] py-[9px]"
                  style={{ background: 'var(--raised)', border: '1px solid var(--line-2)' }}
                >
                  <p className="bidi m-0 t-body leading-[1.6]" style={{ color: 'var(--text-1)' }}>
                    {b.text}
                  </p>
                </div>
              </motion.div>
            )

          case 'text': {
            const { prose, calls } = splitToolCalls(b.text)
            return (
              <motion.div key={b.id} variants={rise} initial="initial" animate="animate">
                <div className="md bidi" dir="auto" style={{ color: 'var(--text-1)' }}>
                  {prose && (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeSanitize]}
                    components={{
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          onClick={(ev) => {
                            /* never navigate the app; hand it to the OS */
                            ev.preventDefault()
                            const bridge = (window as unknown as { loong?: { openExternal?: (u: string) => void } })
                              .loong
                            if (href) bridge?.openExternal?.(href)
                          }}
                          title={href}
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {prose}
                  </ReactMarkdown>
                  )}
                  {b.streaming && <span className="caret" aria-hidden />}
                </div>

                {/* the machine artefact, folded: visible, never shouted */}
                {calls && (
                  <RailRow
                    state="done"
                    label={<span className="mono">tool call written as text — no tool ran</span>}
                    meta="this model cannot emit tool calls"
                  >
                    <p className="m-0 mb-[6px] t-small leading-[1.55]" style={{ color: 'var(--text-2)' }}>
                      This endpoint's model writes the call into the message instead of
                      emitting a real tool call, so the agent had nothing to execute and the
                      run ended after one step. Switch to a model that supports tool calling —
                      a local one, or a hosted one with a function-calling API.
                    </p>
                    <Code text={calls} tone={3} max={3000} />
                  </RailRow>
                )}
              </motion.div>
            )
          }

          case 'thinking':
            if (!showThinking) return null
            return (
              <motion.div key={b.id} variants={rise} initial="initial" animate="animate">
                <RailRow state="done" label={<span className="mono">thinking</span>} meta={`${b.chars.toLocaleString()} chars`}>
                  <p className="bidi m-0 t-small leading-[1.65]" style={{ color: 'var(--text-3)' }}>
                    {b.text}
                  </p>
                </RailRow>
              </motion.div>
            )

          case 'tool':
            return (
              <motion.div key={b.id} variants={rise} initial="initial" animate="animate">
                <RailRow
                  state={b.live ? 'live' : b.ok === false ? 'failed' : 'done'}
                  label={<span className="mono">{b.wire}</span>}
                  meta={
                    <>
                      {b.live ? 'running' : b.ms ? `${(b.ms / 1000).toFixed(1)}s` : ''}
                    </>
                  }
                  startOpen={verbose || b.ok === false}
                >
                  <div className="flex flex-col gap-[6px]">
                    {b.args && <Code text={b.args} tone={3} max={1400} />}
                    {b.result && <Code text={b.result} tone={2} />}
                  </div>
                </RailRow>
              </motion.div>
            )

          case 'plan':
            return <PlanCard key={b.id} plan={b.plan} />

          case 'approval':
            return <ApprovalCard key={b.id} request={b.request} onDecide={p.onDecide} />

          case 'question':
            return <QuestionCard key={b.id} request={b.request} onAnswer={p.onAnswer} />

          case 'audit':
            return <AuditCard key={b.id} audit={b.audit} />

          case 'check':
            return (
              <motion.div key={b.id} variants={rise} initial="initial" animate="animate" className="flex items-baseline gap-[8px] px-[6px]">
                <span className="t-small" style={{ color: b.ok ? 'var(--ok)' : 'var(--fail)' }}>
                  {b.ok ? '✓' : '×'}
                </span>
                <span className="bidi t-small" style={{ color: 'var(--text-2)' }}>
                  {b.label}
                </span>
              </motion.div>
            )

          case 'screenshot':
            return (
              <motion.div key={b.id} variants={rise} initial="initial" animate="animate" className="px-[6px]">
                <img
                  src={api.shotUrl(b.path)}
                  alt={`A screenshot taken by ${b.tool}`}
                  className="max-w-full rounded-[10px]"
                  style={{ border: '1px solid var(--line-2)' }}
                />
              </motion.div>
            )

          case 'stop':
            return (
              <motion.div key={b.id} variants={rise} initial="initial" animate="animate">
                <RailRow
                  state={b.reason === 'step-limit' ? 'failed' : 'done'}
                  label={<span className="mono">{b.reason === 'step-limit' ? 'step limit reached' : 'stopped'}</span>}
                  meta={b.model}
                >
                  <p className="bidi m-0 t-small leading-[1.6]" style={{ color: 'var(--text-2)' }}>
                    {b.text}
                  </p>
                </RailRow>
              </motion.div>
            )

          case 'notice':
            return (
              <motion.p
                key={b.id}
                variants={rise}
                initial="initial"
                animate="animate"
                className="bidi m-0 px-[6px] t-small leading-[1.6]"
                style={{ color: 'var(--text-2)' }}
              >
                {b.text}
              </motion.p>
            )

          case 'subagent':
            return (
              <motion.div key={b.id} variants={rise} initial="initial" animate="animate">
                <RailRow state={b.phase === 'done' ? 'done' : 'live'} label={<span className="mono">{b.scope || 'subagent'}</span>} meta={b.phase}>
                  <p className="bidi m-0 t-small leading-[1.6]" style={{ color: 'var(--text-3)' }}>
                    {b.task}
                    {b.detail ? ` — ${b.detail}` : ''}
                  </p>
                </RailRow>
              </motion.div>
            )

          case 'failed':
            return (
              <motion.div key={b.id} variants={card} initial="initial" animate="animate" className="rounded-[12px] px-[14px] py-[11px]" style={{ border: '1px solid var(--line-2)', background: 'var(--raised)' }}>
                <p className="mono m-0 mb-[4px] t-tiny uppercase tracking-[0.12em]" style={{ color: 'var(--fail)' }}>
                  Failed
                </p>
                <p className="bidi m-0 t-small leading-[1.6]" style={{ color: 'var(--text-1)' }}>
                  {b.detail || b.cause}
                </p>
                <button
                  type="button"
                  onClick={p.onRetry}
                  className="ctl mt-[9px] rounded-[7px] px-[12px] py-[5px] t-small"
                  style={{ border: '1px solid var(--line-3)', color: 'var(--text-1)' }}
                >
                  Retry
                </button>
              </motion.div>
            )

          default:
            return null
        }
      })}

      {p.blocks.length === 0 && !p.bare && <EmptyState running={p.running} />}

      {p.running && last && last.k !== 'text' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-[8px] pl-[2px]"
        >
          <Dragon size={22} mood="working" />
          <Working label="working" />
        </motion.div>
      )}
    </div>
  )
}

export { stagger }
