import { useMemo } from 'react'

/* ---------------------------------------------------------------------------
   Device 3 — guilloche.

   A guilloche is the pattern security printers use to make banknotes and
   passports hard to copy: precisely arranged vector lines traced by a
   spirograph, generated from parameterised sine maths rather than drawn.

   It is used here for the same reason it exists there — it reads as engraved,
   it costs nothing, and it cannot be produced by hand. The field is computed
   from numbers on every render, so there is no texture file anywhere.

   It appears in exactly two places: the empty state, and the thinking
   indicator. Anywhere else and it stops being a signature and becomes a
   wallpaper.
   --------------------------------------------------------------------------- */

interface GuillocheProps {
  width: number
  height: number
  /** how many parallel sine traces stack up */
  lines?: number
  /** horizontal distance of one full wave */
  period?: number
  /** vertical travel of each trace */
  amplitude?: number
  /** extra amplitude added per line, so the field fans out */
  spread?: number
  /** shift each trace sideways, in radians */
  phaseStep?: number
  className?: string
  opacity?: number
  style?: React.CSSProperties
}

function sinePath(
  width: number,
  mid: number,
  amplitude: number,
  period: number,
  phase: number,
): string {
  const half = period / 2
  const ctrl = amplitude / 0.75
  const startY = mid + amplitude * Math.sin(phase)
  let d = `M0 ${startY.toFixed(2)}`
  let x = 0
  let dir = -1
  while (x < width) {
    const nx = Math.min(x + half, width)
    const seg = nx - x
    d +=
      ` C${(x + seg / 3).toFixed(2)} ${(mid + dir * ctrl).toFixed(2)}` +
      ` ${(x + (2 * seg) / 3).toFixed(2)} ${(mid + dir * ctrl).toFixed(2)}` +
      ` ${nx.toFixed(2)} ${mid.toFixed(2)}`
    x = nx
    dir = -dir
  }
  return d
}

export function Guilloche({
  width,
  height,
  lines = 9,
  period = 56,
  amplitude = 5,
  spread = 2.6,
  phaseStep = 0.34,
  className,
  opacity = 1,
  style,
}: GuillocheProps) {
  const paths = useMemo(() => {
    const out: string[] = []
    const mid = height / 2
    for (let i = 0; i < lines; i++) {
      const centred = i - (lines - 1) / 2
      const y = mid + centred * (height / (lines + 1.6))
      const amp = amplitude + Math.abs(centred) * spread
      out.push(sinePath(width, y, amp, period, i * phaseStep))
    }
    return out
  }, [width, height, lines, period, amplitude, spread, phaseStep])

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ opacity, ...style }}
      aria-hidden="true"
      focusable="false"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="0.5"
        strokeLinecap="round"
      >
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  )
}
