import type { Block } from './blocks'

const WRITE_TOOLS = new Set([
  'write_file', 'edit_file', 'multi_edit', 'edit_many', 'propose_changes',
  'delete_file', 'move_file', 'mkdir', 'run_code',
])
const TERMINAL_TOOLS = new Set(['shell', 'terminal', 'server_start', 'run_project', 'run_verification'])

/** Evidence is scoped to the most recent user request, not an earlier task. */
export function taskBlocks(blocks: Block[]): Block[] {
  let start = 0
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i].k === 'user') { start = i; break }
  }
  return blocks.slice(start)
}

/** A continuation keeps the task's substantive objective visible. */
export function taskObjective(blocks: Block[]): Extract<Block, { k: 'user' }> | undefined {
  const users = blocks.filter((block): block is Extract<Block, { k: 'user' }> => block.k === 'user')
  return [...users].reverse().find((block) => !/^(?:continue|resume|carry on|keep going|اكمل|أكمل|كمل|تابع|استمر)[.!؟…\s]*$/iu.test(block.text.trim())) ?? users.at(-1)
}

export function checkEvidence(blocks: Block[]) {
  const task = taskBlocks(blocks)
  return task.flatMap((block, index) => {
    if (block.k !== 'check') return []
    const stale = task.slice(index + 1).some(
      (later) => later.k === 'notice' && later.id.startsWith('rewind-') ||
        later.k === 'tool' && !later.live && later.ok !== false && WRITE_TOOLS.has(later.tool),
    )
    return [{ ...block, stale }]
  })
}

export function terminalEvidence(blocks: Block[]) {
  return taskBlocks(blocks).filter(
    (block): block is Extract<Block, { k: 'tool' }> => block.k === 'tool' && TERMINAL_TOOLS.has(block.tool),
  )
}

export const OUTCOME_LABEL: Record<string, string> = {
  completed: 'Completed', partial: 'Partially completed', blocked: 'Needs attention',
  budget_exhausted: 'Budget reached', cancelled: 'Cancelled', failed: 'Failed',
}

export function outcomeLabel(status: string | null | undefined): string {
  return status ? OUTCOME_LABEL[status] ?? status.replaceAll('_', ' ') : 'Ready'
}
