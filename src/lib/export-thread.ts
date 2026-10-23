import type { Block } from './blocks'

/* ---------------------------------------------------------------------------
   A thread, as a document.

   A conversation you cannot take with you is a conversation you do not own.
   Markdown is the format that survives: it opens in every editor, diffs in
   git, and pastes into any issue tracker without losing its shape.
   --------------------------------------------------------------------------- */

export function threadToMarkdown(title: string, blocks: Block[], meta?: { model?: string }): string {
  const lines: string[] = [`# ${title}`, '']
  if (meta?.model) lines.push(`_model: ${meta.model}_`, '')
  lines.push(`_exported ${new Date().toISOString().slice(0, 19).replace('T', ' ')}_`, '')

  for (const block of blocks) {
    switch (block.k) {
      case 'user':
        lines.push('## You', '', block.text, '')
        break
      case 'text':
        lines.push('## Loong', '', block.text, '')
        break
      case 'thinking':
        lines.push('<details><summary>thinking</summary>', '', block.text, '', '</details>', '')
        break
      case 'tool': {
        const input =
          typeof block.call.input === 'string' ? block.call.input : JSON.stringify(block.call.input, null, 2)
        lines.push(`### tool · ${block.call.title || block.call.tool}`, '', '```', input.slice(0, 4000), '```', '')
        if (block.result) {
          const out = block.result.output ?? ''
          lines.push(
            block.result.ok ? '```' : '```text',
            out.slice(0, 6000),
            '```',
            block.result.ok ? '' : '_failed_',
            '',
          )
        }
        break
      }
      case 'notice':
        lines.push(`> ${block.text}`, '')
        break
      case 'plan':
        lines.push('### plan', '')
        for (const step of block.plan.steps ?? []) {
          lines.push(`- [${step.status === 'done' ? 'x' : ' '}] ${step.description}`)
        }
        lines.push('')
        break
      case 'subagent':
        lines.push(`> subagent (${block.scope}): ${block.task}`, '')
        break
      case 'approval':
        lines.push(`> approval requested: ${block.request.title} — ${block.decision ?? 'pending'}`, '')
        break
      default:
        break
    }
  }
  return lines.join('\n')
}

/** hand the text to the OS as a download — the renderer cannot write files */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function transcriptText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if (b.k === 'user') return `YOU: ${b.text}`
      if (b.k === 'text') return `LOONG: ${b.text}`
      if (b.k === 'tool') return `[tool ${b.call.title ?? b.call.tool}] ${b.result?.ok ? 'ok' : 'failed'}`
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
}
