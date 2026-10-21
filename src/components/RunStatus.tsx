import { useEffect, useState } from 'react'
import type { Block } from '../lib/blocks'

/* ---------------------------------------------------------------------------
   The run, spoken.

   Every state the interface shows — thinking, running a tool, waiting for an
   approval, failing, finishing — was silent to a screen reader: there was no
   aria-live region anywhere in src/. This is that region: visually hidden,
   polite, and it speaks only on transitions that matter, not on every block.
   --------------------------------------------------------------------------- */

export function RunStatus({
  running,
  blocks,
  error,
}: {
  running: boolean
  blocks: Block[]
  error: string | null
}) {
  const [said, setSaid] = useState('')
  const last = blocks[blocks.length - 1]

  useEffect(() => {
    if (error) {
      setSaid(`Run failed: ${error}`)
      return
    }
    if (running) {
      if (last?.k === 'tool' && !last.result) {
        setSaid(`Working: ${last.call.title}`)
      } else if (last?.k === 'plan') {
        setSaid('Plan updated')
      } else {
        setSaid('Loong is working')
      }
      return
    }
    if (blocks.length > 0) setSaid('Run finished')
  }, [running, error, last, blocks.length])

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        margin: -1,
        padding: 0,
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {said}
    </div>
  )
}
