import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { QuestionRequest } from '../lib/contract'
import { dur, easeOut, spring } from '../motion/tokens'
import { sound } from '../lib/sound'
import { Clamped } from './Clamped'

/* ---------------------------------------------------------------------------
   The question.

   The agent asked something and the run is parked behind this card. Nothing
   else is true until it is answered: no more tokens, no tool, no progress bar.

   The answer is free text, because the useful question is rarely a multiple
   choice. The chips are shortcuts for the answers that are, and they are
   suggestions — typing your own is always available.
   --------------------------------------------------------------------------- */

interface QuestionCardProps {
  request: QuestionRequest
  answer?: string | null
  onAnswer: (id: string, answer: string | null) => void
}

export function QuestionCard({ request, answer, onAnswer }: QuestionCardProps) {
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const answered = answer !== undefined

  /* the run is waiting, so the field is where the eyes already are */
  useEffect(() => {
    if (!answered) {
      const t = window.setTimeout(() => input.current?.focus(), 120)
      return () => window.clearTimeout(t)
    }
  }, [answered])

  const submit = (value: string) => {
    const text = value.trim()
    if (!text) return
    sound.play('approve')
    onAnswer(request.id, text)
  }

  if (answered) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: dur.enter, ease: easeOut }}
        className="rounded-[9px] px-[13px] py-[10px]"
        style={{
          border: '1px solid var(--line-2)',
          background: 'var(--canvas)',
        }}
      >
        <p
          className="m-0 text-[10px] tracking-[0.1em] uppercase"
          style={{ color: 'var(--text-4)' }}
        >
          Asked
        </p>
        <p
          dir="auto"
          className="bidi mt-[5px] mb-[8px] text-[12.5px] leading-[1.55]"
          style={{ color: 'var(--text-2)' }}
        >
          {request.question}
        </p>
        <div
          className="rule-engraved mb-[8px]"
          aria-hidden
        />
        <p
          className="m-0 text-[10px] tracking-[0.1em] uppercase"
          style={{ color: 'var(--text-4)' }}
        >
          You said
        </p>
        <p
          dir="auto"
          className="bidi mt-[5px] mb-0 text-[12.5px] leading-[1.55]"
          style={{ color: 'var(--text-1)' }}
        >
          {/* null means the reader never answered; a literal "no answer" is a
              real answer and is shown as one */}
          {answer === null ? 'no answer given' : answer}
        </p>
      </motion.div>
    )
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur.enter, ease: easeOut }}
      className="rounded-[9px] px-[13px] py-[11px]"
      style={{
        /* the only filled panel in the thread besides a user turn — a parked
           run is the one thing that must not be missed */
        border: '1px solid var(--line-4)',
        background: 'var(--surface-sunken)',
      }}
    >
      <div className="flex items-center gap-[7px]">
        <motion.span
          className="block h-[5px] w-[5px] shrink-0 rounded-full"
          style={{ background: 'var(--text-2)' }}
          animate={{ opacity: [0.35, 1, 0.35] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <p
          className="mono m-0 text-[10px] tracking-[0.1em] uppercase"
          style={{ color: 'var(--text-3)' }}
        >
          Waiting on you
        </p>
      </div>

      <Clamped text={request.question} />

      {request.detail && (
        <p
          dir="auto"
          className="bidi mt-[6px] mb-0 text-[11.5px] leading-[1.6]"
          style={{ color: 'var(--text-3)' }}
        >
          {request.detail}
        </p>
      )}

      {request.options.length > 0 && (
        <div className="mt-[9px] flex flex-wrap gap-[5px]">
          {request.options.map((opt) => (
            <button
              key={opt}
              type="button"
              className="ctl rounded-[6px] px-[9px] py-[4px] text-[11.5px]"
              style={{
                border: '1px solid var(--line-3)',
                color: 'var(--text-2)',
                background: 'var(--surface)',
              }}
              onClick={() => submit(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      <div
        className="mt-[9px] flex items-start gap-[8px] rounded-[7px] px-[9px] py-[7px]"
        style={{ border: '1px solid var(--line-2)', background: 'var(--canvas)' }}
      >
        <textarea
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit(draft)
            }
          }}
          rows={2}
          dir="auto"
          placeholder="Answer…"
          className="bidi block w-full resize-none bg-transparent text-[12.5px] outline-none"
          style={{ color: 'var(--text-1)' }}
        />
      </div>

      <div className="mt-[4px] flex items-center justify-end gap-[7px]">
        <button
          type="button"
          className="ctl rounded-[6px] px-[10px] py-[5px] text-[11.5px]"
          style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
          onClick={() => {
            sound.play('select')
            onAnswer(request.id, null)
          }}
        >
          Skip — let the agent decide
        </button>
        <motion.button
          type="button"
          className="ctl rounded-[7px] px-[13px] py-[6px] text-[12.5px]"
          style={{
            background: 'var(--text-1)',
            color: 'var(--canvas)',
            fontWeight: 500,
          }}
          whileTap={{ scale: 0.97 }}
          transition={spring.snap}
          onClick={() => submit(draft)}
          disabled={draft.trim().length === 0}
        >
          Answer
        </motion.button>
      </div>
    </motion.div>
  )
}
