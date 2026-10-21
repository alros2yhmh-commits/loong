import { useState } from 'react'

/* ---------------------------------------------------------------------------
   The resize grip.

   Five pixels wide, invisible until you are on it, one hairline when you are.
   It is the only affordance in the app that is hidden by default — because a
   window full of permanent grab handles is a window that looks unfinished.
   Double-click resets, which is the gesture people already expect.
   --------------------------------------------------------------------------- */

interface ResizerProps {
  onPointerDown: (e: React.PointerEvent) => void
  onReset: () => void
  dragging: boolean
  label: string
}

export function Resizer({
  onPointerDown,
  onReset,
  dragging,
  label,
}: ResizerProps) {
  const [hover, setHover] = useState(false)
  const lit = dragging || hover

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label} — drag, double-click to reset`}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative z-40 -mx-[2px] w-[5px] shrink-0 cursor-col-resize"
    >
      <div
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2"
        style={{
          background: lit ? 'var(--line-4)' : 'transparent',
          transition: 'background-color var(--dur-hover) var(--ease-out)',
        }}
      />
    </div>
  )
}
