import { motion } from 'motion/react'
import { t, e } from '../lib/motion'

/* ===========================================================================
   The dragon.

   The mark is a hand-drawn twelve-point star, black on white. The creature is
   drawn in the same hand: one ink, thick strokes, small deliberate
   imperfections. It has three legs, because the brief asked for three, and
   because a creature on three legs always looks like it is about to do
   something.

   The only colour in the entire interface is this amber. It means "the agent is
   alive". Nothing else is allowed to use it.
   =========================================================================== */

/** the star: twelve points, drawn slightly off, filled with the ink */
export function Mark({ size = 16, tone = 'ink' }: { size?: number; tone?: 'ink' | 'amber' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden style={{ display: 'block' }}>
      <g fill={tone === 'amber' ? 'var(--amber)' : 'var(--text-1)'}>
        {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg, i) => (
          <rect
            key={deg}
            x="22.4"
            y="1.6"
            width="3.2"
            height={i % 3 === 0 ? 17 : i % 3 === 1 ? 15.4 : 16.2}
            rx="1.5"
            transform={`rotate(${deg + (i % 2 ? 1.4 : -1.1)} 24 24)`}
          />
        ))}
        <circle cx="24" cy="24" r="7.4" />
      </g>
    </svg>
  )
}

export type Mood = 'idle' | 'working' | 'waiting' | 'happy' | 'failed'

/**
 * The creature.
 *
 * Idle behaviour is deliberately small: a slow breath, and a blink every few
 * seconds. It is company, not a spinner — anything busier competes with the
 * work in the transcript.
 */
export function Dragon({ size = 96, mood = 'idle' }: { size?: number; mood?: Mood }) {
  const ink = mood === 'failed' ? 'var(--text-3)' : 'var(--amber)'

  const bob =
    mood === 'working'
      ? { y: [0, -3, 0], transition: { duration: 1.1, repeat: Infinity, ease: 'easeInOut' as const } }
      : mood === 'waiting'
        ? { rotate: [0, -3, 3, 0], transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' as const } }
        : mood === 'happy'
          ? { y: [0, -5, 0], transition: { duration: 0.5, repeat: 1, ease: e.out } }
          : { y: [0, -1.5, 0], transition: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' as const } }

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="Loong"
      animate={bob}
      style={{ overflow: 'visible' }}
    >
      <g fill="none" stroke={ink} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        {/* the shell: one closed body, hand-drawn so the halves differ */}
        <path d="M30.6 57.4c0-14.8 12.8-26.2 29.4-26.2 16.8 0 29.6 11.4 29.6 26.2 0 13.6-9.6 23.8-23.4 25.4-2.6.3-4.6.4-6.2.4-1.8 0-3.8-.1-6.2-.4C40 81.2 30.6 71 30.6 57.4z" />
        {/* three legs, standing apart */}
        <path d="M40.6 82.6c-1.4 4.6-2 8.6-1.6 12" />
        <path d="M60 83.6c0 4.6.2 8.4.6 11.4" />
        <path d="M79 82.2c1.6 4.6 2.2 8.6 1.8 12" />
        {/* the antenna: the creature's only flourish */}
        <path d="M60.4 32.8c.4-4.2 1.6-7.2 3.4-9.4" strokeWidth="3" />
      </g>

      <circle cx="64.6" cy="21.4" r="2.6" fill={ink} />

      {/* the eyes: two dots, blinking on their own clock */}
      <motion.g
        fill={ink}
        animate={{ scaleY: [1, 1, 0.1, 1, 1] }}
        transition={{ duration: 5.6, times: [0, 0.86, 0.9, 0.94, 1], repeat: Infinity, repeatDelay: 1.8 }}
        style={{ transformOrigin: '60px 55px' }}
      >
        <circle cx="50.4" cy="54.6" r="2.6" />
        <circle cx="69.2" cy="54.2" r="2.6" />
      </motion.g>

      {/* waiting: a small amber halo, so the state is visible without words */}
      {mood === 'waiting' && (
        <motion.circle
          cx="60"
          cy="60"
          r="44"
          fill="none"
          stroke="var(--amber-line)"
          strokeWidth="1.2"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: [0.15, 0.5, 0.15], scale: 1 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformOrigin: '60px 60px' }}
        />
      )}
    </motion.svg>
  )
}

/** the mark in a tile — the app's identity wherever a logo sits */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        border: '1px solid var(--line-2)',
        background: 'var(--raised)',
      }}
    >
      <Mark size={size * 0.6} />
    </span>
  )
}

/** the working indicator: three dots that breathe in sequence */
export function Working({ label = 'working' }: { label?: string }) {
  return (
    <span className="flex items-center gap-[7px]">
      <span className="flex items-center gap-[3px]">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="inline-block h-[4px] w-[4px] rounded-full"
            style={{ background: 'var(--amber)' }}
            animate={{ opacity: [0.25, 1, 0.25] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.14, ease: 'easeInOut' }}
          />
        ))}
      </span>
      <span className="t-tiny" style={{ color: 'var(--text-3)' }}>
        {label}
      </span>
    </span>
  )
}

export { t }
