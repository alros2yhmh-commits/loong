import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { dur, easeOut } from '../motion/tokens'
import { sound } from '../lib/sound'
import { RichText } from './RichText'

/* ---------------------------------------------------------------------------
   Long content.

   A model can return a hundred thousand characters in one message, and a
   hundred thousand characters is a hundred thousand DOM nodes. Rendering them
   and then hiding them with `max-height` does not help — the work is already
   done by the time the CSS applies.

   So the clamp is on the string, not the box. Only the first slice is ever
   parsed and mounted. The fade is a mask, which means it works on any
   background and costs nothing.

   `Show less` is offered rather than required: expanding is the user's choice
   and they should be able to undo it without losing their place.
   --------------------------------------------------------------------------- */

const CLAMP = 1400

interface ClampedProps {
  text: string
  /** the composer and the thread already have their own sizes */
  label?: string
}

export function Clamped({ text, label = 'message' }: ClampedProps) {
  const [open, setOpen] = useState(false)
  const long = text.length > CLAMP
  const shown = long && !open ? text.slice(0, CLAMP) : text
  const hidden = text.length - CLAMP

  return (
    <div>
      <div
        className="relative"
        style={
          long && !open
            ? {
                maskImage:
                  'linear-gradient(to bottom, #000 55%, transparent 100%)',
                WebkitMaskImage:
                  'linear-gradient(to bottom, #000 55%, transparent 100%)',
              }
            : undefined
        }
      >
        <RichText text={shown} />
        {long && !open && <span style={{ opacity: 0 }}>…</span>}
      </div>

      <AnimatePresence initial={false}>
        {long && (
          <motion.div
            key="toggle"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: dur.enter, ease: easeOut }}
            className="mt-[9px] flex items-center gap-[9px]"
          >
            <button
              type="button"
              className="ctl rounded-[5px] px-[9px] py-[3px] text-[11.5px]"
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
            <span
              className="mono text-[10.5px]"
              style={{ color: 'var(--text-4)' }}
            >
              {open
                ? `showing all ${text.length.toLocaleString()} characters`
                : `${hidden.toLocaleString()} more characters of this ${label}`}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
