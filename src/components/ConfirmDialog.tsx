import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { dur, easeOut, spring } from '../motion/tokens'

/* ---------------------------------------------------------------------------
   Confirm — the one place Loong asks a destructive question.

   A modal is heavy machinery, and Loong avoids it everywhere except here:
   deleting a thread is the one action in the app that cannot be undone, so it
   gets a real gate. Monochrome, hairline, short — the way a considered prompt
   looks, not an alarm.
   --------------------------------------------------------------------------- */

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  body?: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const reduced = useReducedMotion()
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-[80] flex items-center justify-center"
          style={{ background: 'var(--scrim)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur.enter, ease: easeOut }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onCancel()
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="w-[400px] max-w-[calc(100vw-48px)] overflow-hidden rounded-[12px] px-[18px] pt-[16px] pb-[14px]"
            style={{ background: 'var(--canvas)', border: '1px solid var(--line-4)' }}
            initial={reduced ? false : { opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? undefined : { opacity: 0, y: -4, scale: 0.99 }}
            transition={spring.drawer}
          >
            <p className="m-0 text-[13.5px]" style={{ color: 'var(--text-1)' }}>
              {title}
            </p>
            {body && (
              <p className="mt-[6px] mb-0 text-[12px] leading-[1.6]" style={{ color: 'var(--text-3)' }}>
                {body}
              </p>
            )}
            <div className="mt-[16px] flex items-center justify-end gap-[8px]">
              <button
                type="button"
                className="ctl rounded-[7px] px-[13px] py-[6px] text-[12.5px]"
                style={{ border: '1px solid var(--line-3)', color: 'var(--text-2)' }}
                onClick={onCancel}
              >
                Cancel
              </button>
              <motion.button
                type="button"
                className="rounded-[7px] px-[13px] py-[6px] text-[12.5px]"
                style={{ background: 'var(--text-1)', color: 'var(--canvas)', fontWeight: 500 }}
                whileTap={{ scale: 0.97 }}
                transition={spring.snap}
                onClick={onConfirm}
              >
                {confirmLabel}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
