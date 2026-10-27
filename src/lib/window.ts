/* ---------------------------------------------------------------------------
   A conversation that runs for days is thousands of blocks, and rendering all
   of them is what makes a long thread stutter: the browser lays out every old
   tool row on every streamed token.

   The transcript shows a window on the tail — where the work is — and one click
   at the top reveals the page before it. Nothing is deleted from state; only the
   DOM is bounded.
   --------------------------------------------------------------------------- */

/** how many blocks the transcript renders before asking */
export const TRANSCRIPT_TAIL = 120
/** how many more each "earlier" click adds */
export const TRANSCRIPT_PAGE = 80

export interface Windowed<T> {
  /** index of the first shown block in the full list */
  start: number
  shown: T[]
  hidden: number
}

export function windowBlocks<T>(blocks: T[], limit = TRANSCRIPT_TAIL): Windowed<T> {
  const size = Math.max(1, Math.floor(limit))
  const start = Math.max(0, blocks.length - size)
  return { start, shown: blocks.slice(start), hidden: start }
}
