import { useCallback, useEffect, useRef, useState } from 'react'

/* ---------------------------------------------------------------------------
   The edge reveal.

   The drawer is not a column that is always there taking up space. It is a
   surface that wakes when the pointer is actually against the bezel — a four
   pixel hot zone, the same gesture people already use for the Windows taskbar
   and macOS Dock.

   Two details matter, and both were bugs in the fixture that shipped with this
   app before the fix:

   - The zone must be tiny. Twenty-four pixels is about one percent of a wide
     display, which is enough to catch a text selection that ends near the edge.
   - The grace period must be longer than the panel's own spring. A drawer that
     dismisses itself while it is still animating in is the classic version of
     this bug.
   --------------------------------------------------------------------------- */

export interface EdgeRevealOptions {
  /** how close to the bezel the pointer must be, in px */
  zone?: number
  /** width of the panel, in px */
  width?: number
  /** how long the pointer must leave before it closes, in ms */
  grace?: number
}

export function useEdgeReveal({
  zone = 4,
  width = 320,
  grace = 620,
}: EdgeRevealOptions = {}) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  /** pointer is in the bezel zone — drives the affordance, before the panel */
  const [hot, setHot] = useState(false)

  const openRef = useRef(open)
  const pinnedRef = useRef(pinned)
  const closeTimer = useRef<number | null>(null)
  const openTimer = useRef<number | null>(null)

  openRef.current = open
  pinnedRef.current = pinned

  const cancel = (id: React.MutableRefObject<number | null>) => {
    if (id.current !== null) {
      window.clearTimeout(id.current)
      id.current = null
    }
  }

  const reveal = useCallback(() => {
    cancel(closeTimer)
    setHot(true)
    if (openRef.current) return
    /* a short delay so a pointer sweeping past the edge does not flash it open */
    cancel(openTimer)
    openTimer.current = window.setTimeout(() => setOpen(true), 110)
  }, [])

  const scheduleClose = useCallback(() => {
    cancel(openTimer)
    setHot(false)
    if (pinnedRef.current) return
    cancel(closeTimer)
    closeTimer.current = window.setTimeout(() => setOpen(false), grace)
  }, [grace])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const w = window.innerWidth
      const inZone = e.clientX >= w - zone
      const inPanel = openRef.current && e.clientX >= w - width - 8
      /* never reveal while the pointer is over a scrollable region — the
         thread's scrollbar lives at the same right edge, and a drawer that
         pops open when you grab it is a drawer that blocks scrolling */
      const overScroll = Boolean(
        (e.target as Element | null)?.closest?.('[data-scroll-region]'),
      )
      if (overScroll && !inPanel) {
        scheduleClose()
        return
      }
      if (inZone || inPanel) reveal()
      else scheduleClose()
    }
    const onLeave = () => scheduleClose()

    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      cancel(closeTimer)
      cancel(openTimer)
    }
  }, [zone, width, reveal, scheduleClose])

  /* pinning keeps it open regardless of the pointer */
  useEffect(() => {
    if (pinned) {
      cancel(closeTimer)
      setOpen(true)
    }
  }, [pinned])

  /** a button-driven peek: open, then fall back to the edge rule on its own */
  const peek = useCallback(() => {
    cancel(closeTimer)
    cancel(openTimer)
    setHot(true)
    setOpen(true)
    openTimer.current = window.setTimeout(() => {
      setHot(false)
      if (!pinnedRef.current) setOpen(false)
    }, 2800)
  }, [])

  return { open, pinned, setPinned, hot, zone, peek }
}
