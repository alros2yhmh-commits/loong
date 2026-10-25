import { motion } from 'motion/react'

/* ===========================================================================
   The mark, and the creature.

   The icon is a hand-drawn twelve-point star — thick, slightly irregular
   strokes, black on white. The creature below is drawn in the same hand: the
   same stroke weight, the same small imperfections, the same single ink. It is
   a small animal on three legs, because three is what the brief asked for and
   because a creature that stands on three legs always looks like it is about
   to do something.

   Everything is a path. No image asset, no second colour.
   =========================================================================== */

/** the star: twelve points, drawn slightly off, filled with the ink */
export function Mark({ size = 18, spin = false }: { size?: number; spin?: boolean }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden
      animate={spin ? { rotate: 360 } : undefined}
      transition={spin ? { duration: 12, repeat: Infinity, ease: 'linear' } : undefined}
      style={{ display: 'block' }}
    >
      <g fill="var(--text-1)">
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
    </motion.svg>
  )
}

/**
 * The creature: a small animal on three legs.
 *
 * Idle behaviour is deliberately small — a slow breath, and a blink every few
 * seconds. It is company, not a loading spinner; anything busier would compete
 * with the work in the transcript.
 */
export function Creature({
  size = 96,
  mood = 'idle',
}: {
  size?: number
  mood?: 'idle' | 'working' | 'waiting'
}) {
  const blink = mood === 'idle'

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      aria-label="Loong"
      role="img"
      animate={
        mood === 'working'
          ? { y: [0, -2.5, 0] }
          : mood === 'waiting'
            ? { rotate: [0, -2, 2, 0] }
            : { y: [0, -1.4, 0] }
      }
      transition={{
        duration: mood === 'working' ? 1.1 : 3.4,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    >
      <g fill="none" stroke="var(--text-1)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        {/* the body: one closed shell, hand-drawn so the two halves are not
            identical — a shape, not a circle */}
        <path d="M30.6 57.4c0-14.8 12.8-26.2 29.4-26.2 16.8 0 29.6 11.4 29.6 26.2 0 13.6-9.6 23.8-23.4 25.4-2.6.3-4.6.4-6.2.4-1.8 0-3.8-.1-6.2-.4C40 81.2 30.6 71 30.6 57.4z" />

        {/* the three legs: they start where the shell ends and stand apart, so
            the creature is unmistakably on three legs and not on a skirt */}
        <path d="M40.6 82.6c-1.4 4.6-2 8.6-1.6 12" />
        <path d="M60 83.6c0 4.6.2 8.4.6 11.4" />
        <path d="M79 82.2c1.6 4.6 2.2 8.6 1.8 12" />
      </g>

      {/* the eyes: two filled dots, blinking on their own clock */}
      <motion.g
        fill="var(--text-1)"
        animate={blink ? { scaleY: [1, 1, 0.12, 1, 1] } : undefined}
        transition={
          blink
            ? { duration: 5.6, times: [0, 0.86, 0.9, 0.94, 1], repeat: Infinity, repeatDelay: 1.6 }
            : undefined
        }
        style={{ transformOrigin: '60px 55px' }}
      >
        <circle cx="50.4" cy="54.6" r="2.5" />
        <circle cx="69.2" cy="54.2" r="2.5" />
      </motion.g>

      {/* the antenna: one stroke, slightly bent — the creature's only flourish */}
      <path
        d="M60.4 32.8c.4-4.2 1.6-7.2 3.4-9.4"
        fill="none"
        stroke="var(--text-1)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="64.6" cy="21.4" r="2.6" fill="var(--text-1)" />
    </motion.svg>
  )
}

/** the mark inside a rounded tile — the app's identity wherever a logo sits */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        border: '1px solid var(--line-2)',
        background: 'var(--canvas)',
      }}
    >
      <Mark size={size * 0.62} />
    </span>
  )
}
