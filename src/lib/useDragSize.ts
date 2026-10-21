import { useCallback, useEffect, useRef, useState } from 'react'

/* ---------------------------------------------------------------------------
   Drag-to-resize, persisted.

   Every structural region of the window is adjustable and remembers what the
   user chose. Two rules keep this from becoming a mess:

   - A region only ever resizes along one axis, and only between two bounds the
     caller sets. There is no free-form layout.
   - The composer and tool output are deliberately NOT resizable. The composer
     has to sit at the bottom and stay the same width as the thread or the app
     stops feeling like one column, and tool output has to size to its content
     or every card becomes a different shape.
   --------------------------------------------------------------------------- */

export interface DragSizeOptions {
  /** localStorage key, namespaced by region */
  key: string
  initial: number
  min: number
  max: number
  /** dragging left grows the region — for panels anchored to the right edge */
  invert?: boolean
}

export function useDragSize({
  key,
  initial,
  min,
  max,
  invert = false,
}: DragSizeOptions) {
  const [size, setSize] = useState(() => {
    if (typeof window === 'undefined') return initial
    const raw = window.localStorage.getItem(key)
    const saved = raw === null ? Number.NaN : Number(raw)
    return Number.isFinite(saved) ? Math.min(Math.max(saved, min), max) : initial
  })
  const [dragging, setDragging] = useState(false)

  const sizeRef = useRef(size)
  sizeRef.current = size

  useEffect(() => {
    window.localStorage.setItem(key, String(Math.round(size)))
  }, [key, size])

  const begin = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startSize = sizeRef.current
      const dir = invert ? -1 : 1

      setDragging(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const move = (ev: PointerEvent) => {
        const raw = startSize + (ev.clientX - startX) * dir
        setSize(Math.min(Math.max(raw, min), max))
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setDragging(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [invert, min, max],
  )

  const reset = useCallback(() => setSize(initial), [initial])

  return { size, dragging, begin, reset }
}
