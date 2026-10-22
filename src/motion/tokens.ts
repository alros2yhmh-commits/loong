import type { MotionProps } from 'motion/react'

/* ---------------------------------------------------------------------------
   Motion tokens.

   Five durations, three springs, one easing curve. If a component needs a
   sixth number, the component is wrong.
   --------------------------------------------------------------------------- */

export const dur = {
  press: 0.09,
  hover: 0.14,
  enter: 0.18,
  panel: 0.24,
  slow: 0.42,
} as const

export const easeOut = [0.22, 1, 0.36, 1] as const

export const spring = {
  /** for anything that should feel instant: press feedback, flicks, carets */
  snap: { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 },
  /** for anything that changes layout: cards, lists, indicators */
  settle: { type: 'spring', stiffness: 320, damping: 30, mass: 0.9 },
  /** for anything that is a surface: drawers, palettes, panels */
  drawer: { type: 'spring', stiffness: 250, damping: 27, mass: 1 },
} satisfies Record<string, MotionProps['transition']>

/** enter/exit for a block of content arriving in the thread */
/* Calm by default: a fade, not a slide. Nothing on screen should announce
   itself with movement — ChatGPT settled on this years ago and the reason is
   that motion used sparingly is motion that means something. */
export const enterBlock = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: dur.hover, ease: easeOut },
} satisfies MotionProps

/** list items, staggered by the caller */
export const enterRow = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: dur.enter, ease: easeOut },
} satisfies MotionProps
