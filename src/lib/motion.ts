import type { Transition, Variants } from 'motion/react'

/* ===========================================================================
   The motion vocabulary.

   One place, so every component moves at the same speed and on the same curve.
   A component that invents its own timing is a component that makes the product
   feel assembled instead of designed.

   The rules:
   - Entering is slower than leaving.
   - Nothing moves more than 12px. This is a desktop app, not a landing page.
   - Nothing animates a property that forces a layout, except a deliberate
     height collapse — and those are capped at the panel speed.
   - Reduced motion turns everything into a cross-fade, automatically, through
     one MotionConfig at the root.
   =========================================================================== */

export const t = {
  fast: 0.12,
  base: 0.18,
  slow: 0.28,
  panel: 0.32,
} as const

export const e = {
  out: [0.22, 1, 0.36, 1] as const,
  inOut: [0.65, 0, 0.35, 1] as const,
  spring: [0.34, 1.4, 0.64, 1] as const,
}

export const spring = {
  soft: { type: 'spring', stiffness: 320, damping: 30, mass: 0.7 },
  snappy: { type: 'spring', stiffness: 520, damping: 32, mass: 0.6 },
} as const

/** a row arriving in a list or a stream */
export const rise: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: t.base, ease: e.out } },
  exit: { opacity: 0, y: -4, transition: { duration: t.fast, ease: e.out } },
}

/** a card — an approval, a plan, an artifact */
export const card: Variants = {
  initial: { opacity: 0, y: 10, scale: 0.995 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: t.slow, ease: e.out } },
  exit: { opacity: 0, scale: 0.995, transition: { duration: t.fast, ease: e.out } },
}

/** a menu or a popover */
export const pop: Variants = {
  initial: { opacity: 0, y: -4, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: t.base, ease: e.out } },
  exit: { opacity: 0, y: -4, scale: 0.97, transition: { duration: t.fast, ease: e.out } },
}

/** a dialog */
export const modal: Variants = {
  initial: { opacity: 0, y: 12, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: t.slow, ease: e.out } },
  exit: { opacity: 0, y: 8, scale: 0.985, transition: { duration: t.base, ease: e.out } },
}

export const scrim: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: t.base } },
  exit: { opacity: 0, transition: { duration: t.fast } },
}

/** a collapsible region */
export const collapse: Variants = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1, transition: { duration: t.panel, ease: e.inOut } },
  exit: { height: 0, opacity: 0, transition: { duration: t.base, ease: e.inOut } },
}

/** a list, staggering its children by 18ms */
export const stagger: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.018, delayChildren: 0.02 } },
}

/** the standard transition for a layout change */
export const layoutTransition: Transition = { duration: t.panel, ease: e.inOut }
