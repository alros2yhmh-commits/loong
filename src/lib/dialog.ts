import { useEffect, useRef, type RefObject } from 'react'

/** Keep modal keyboard navigation inside the dialog and restore its opener. */
export function useDialogFocus<T extends HTMLElement>(open: boolean, ref: RefObject<T | null>, onClose: () => void) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = ref.current
    if (!node) return
    const controls = () => Array.from(node.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]',
    )).filter((element) => element.getClientRects().length > 0)
    ;(controls()[0] ?? node).focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close.current()
      } else if (event.key === 'Tab') {
        const list = controls()
        const first = list[0]
        const last = list[list.length - 1]
        if (!first) { event.preventDefault(); node.focus() }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
          event.preventDefault(); last.focus()
        } else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) {
          event.preventDefault(); first.focus()
        }
      }
    }
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      if (opener?.isConnected) opener.focus()
    }
  }, [open, ref])
}
