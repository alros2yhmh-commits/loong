import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect } from 'react'
import type { ApprovalDecision, ApprovalRequest } from '../lib/contract'
import { dur, easeOut, spring } from '../motion/tokens'
import { IconCheck, TOOL_ICON } from './Icons'
import { DiffView } from './DiffView'

/* ---------------------------------------------------------------------------
   The approval.

   This is the only place in Loong with a solid, filled button. Everything else
   in the app is a hairline — but this is the one control that authorises
   something that cannot be undone, and it should not look like the others.

   The run has already stopped by the time this renders. It does not continue on
   a timer, and it does not continue because the card was dismissed.
   --------------------------------------------------------------------------- */

interface ApprovalCardProps {
  request: ApprovalRequest
  decision?: ApprovalDecision
  onDecide: (d: ApprovalDecision) => void
}

export function ApprovalCard({
  request,
  decision,
  onDecide,
}: ApprovalCardProps) {
  const reduced = useReducedMotion()
  const Icon = TOOL_ICON[request.tool]
  const pending = !decision

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onDecide('deny')
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        onDecide('approve')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, onDecide])

  return (
    <motion.div
      layout={reduced ? false : 'position'}
      transition={spring.settle}
      className="relative overflow-hidden rounded-[9px]"
      style={{
        border: `1px solid ${pending ? 'var(--line-4)' : 'var(--line-2)'}`,
        background: 'var(--surface-sunken)',
      }}
    >
      {/* a hairline that breathes while the agent is held up. the only looping
          animation in the app that is allowed to be noticeable, because being
          noticed is the entire job of this card. */}
      <motion.div
        className="h-[1px] w-full"
        style={{ background: 'var(--line-5)', transformOrigin: 'left' }}
        animate={
          pending && !reduced ? { opacity: [1, 0.22, 1] } : { opacity: 1 }
        }
        transition={{ duration: 2.1, repeat: pending ? Infinity : 0, ease: easeOut }}
      />

      <div className="px-[13px] py-[12px]">
        <div className="flex items-center gap-[8px]">
          <span style={{ color: 'var(--text-1)', display: 'grid', placeItems: 'center' }}>
            <Icon size={14} />
          </span>
          <span className="text-[12.5px]" style={{ color: 'var(--text-1)' }}>
            {pending ? 'Needs your approval' : 'Approval'}
          </span>
          <span
            className="mono text-[10.5px]"
            style={{ color: 'var(--text-4)' }}
          >
            {request.wire ?? request.tool}
          </span>
        </div>

        <p
          className="mono mt-[9px] mb-0 text-[11.5px]"
          style={{ color: 'var(--text-2)' }}
        >
          {request.title}
        </p>

        <p
          className="mono mt-[6px] mb-0 text-[12.5px] leading-[1.62]"
          style={{ color: 'var(--text-3)' }}
        >
          {request.detail}
        </p>

        {/* the change, rendered as a change: per file, line by line, with the
            +/- marks a reviewer reads. Prose above describes; this shows. */}
        {request.files && request.files.length > 0 && (
          <div className="mt-[10px] flex flex-col gap-[8px]">
            {request.files.map((f) => (
              <DiffView
                key={f.path}
                before={f.before}
                after={f.after}
                filename={f.path}
                review
              />
            ))}
          </div>
        )}

        {/* when the detail is a unified diff, render it as a preformatted block
            so the +/- lines are aligned and colour-coded. A diff that is not
            formatted as a diff just renders as prose above, which it already did. */}
        {!request.files &&
          (request.detail.includes('@@') ||
            request.detail.startsWith('+') ||
            request.detail.startsWith('-')) && (
            <pre
              className="mono mt-[9px] mb-0 max-h-[220px] overflow-auto rounded-[6px] px-[10px] py-[8px] text-[11px] leading-[1.55]"
              style={{
                background: 'var(--surface-sunken)',
                border: '1px solid var(--line-2)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {request.detail.split('\n').map((line, idx) => {
                let color = 'var(--text-3)'
                if (line.startsWith('+')) color = 'var(--text-1)'
                else if (line.startsWith('-')) color = 'var(--text-2)'
                else if (line.startsWith('@@')) color = 'var(--text-4)'
                return (
                  <span key={idx} style={{ color, display: 'block' }}>
                    {line}
                  </span>
                )
              })}
            </pre>
          )}

        <AnimatePresence mode="wait" initial={false}>
          {pending ? (
            <motion.div
              key="actions"
              className="mt-[13px] flex items-center gap-[8px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: dur.hover, ease: easeOut }}
            >
              {/* the one solid control in the application */}
              <motion.button
                type="button"
                data-approve
                className="rounded-[7px] px-[13px] py-[6px] text-[12.5px]"
                style={{
                  background: 'var(--text-1)',
                  color: 'var(--canvas)',
                  fontWeight: 500,
                }}
                whileTap={{ scale: 0.97 }}
                transition={spring.snap}
                onClick={() => onDecide('approve')}
              >
                Approve
              </motion.button>
              <button
                type="button"
                data-deny
                className="ctl rounded-[7px] px-[13px] py-[6px] text-[12.5px]"
                style={{
                  border: '1px solid var(--line-3)',
                  color: 'var(--text-2)',
                }}
                onClick={() => onDecide('deny')}
              >
                Deny
              </button>
              <span
                className="mono ml-[2px] text-[10.5px]"
                style={{ color: 'var(--text-4)' }}
              >
                ⌘↵ approve · esc deny
              </span>
            </motion.div>
          ) : (
            <motion.div
              key="settled"
              className="mt-[13px] flex items-center gap-[7px]"
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: dur.enter, ease: easeOut }}
            >
              <span
                style={{
                  color: decision === 'approve' ? 'var(--text-1)' : 'var(--text-3)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                {decision === 'approve' ? <IconCheck size={13} /> : null}
              </span>
              <span
                className="text-[12px]"
                style={{
                  color: decision === 'approve' ? 'var(--text-2)' : 'var(--text-3)',
                }}
              >
                {decision === 'approve'
                  ? 'You approved this. The run continued.'
                  : 'You denied this. The file was not touched.'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
