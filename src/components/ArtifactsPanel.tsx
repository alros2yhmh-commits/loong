import { useMemo } from 'react'
import type { Block } from '../lib/blocks'

/* ---------------------------------------------------------------------------
   The artifacts panel.

   "An agent's work is not its transcript." A run that took an hour produces
   diffs, screenshots and test reports — and finding them by scrolling forty
   tool cards is exactly the wrong way to review. So the run's OUTPUTS get
   their own list: everything worth looking at, newest first, one click from
   the place it happened.
   --------------------------------------------------------------------------- */

interface Artifact {
  index: number
  kind: 'change' | 'screenshot' | 'verify' | 'write' | 'research'
  title: string
  meta: string
}

function classify(blocks: Block[]): Artifact[] {
  const out: Artifact[] = []
  blocks.forEach((b, index) => {
    if (b.k === 'screenshot') {
      out.push({
        index,
        kind: 'screenshot',
        title: 'Screenshot',
        meta: b.path.split(/[\\/]/).pop() ?? b.path,
      })
      return
    }
    if (b.k === 'approval' && b.request.files?.length) {
      out.push({
        index,
        kind: 'change',
        title: b.request.title,
        meta: `${b.request.files.length} file(s) · ${b.decision === 'approve' ? 'approved' : b.decision === 'deny' ? 'denied' : 'pending'}`,
      })
      return
    }
    if (b.k === 'tool') {
      const wire = b.call.wire ?? b.call.tool
      if (wire === 'run_verification' && b.result) {
        out.push({
          index,
          kind: 'verify',
          title: b.call.title || 'Verification',
          meta: /PASS/.test(b.result.output)
            ? 'passed'
            : /FAIL/.test(b.result.output)
              ? 'failed'
              : 'ran',
        })
        return
      }
      if ((wire === 'write_file' || wire === 'propose_changes' || wire === 'edit_file') && b.result) {
        const input = (b.call.input ?? {}) as Record<string, unknown>
        const first = typeof input.path === 'string'
          ? input.path
          : Array.isArray(input.files)
            ? `${(input.files as unknown[]).length} files`
            : ''
        out.push({
          index,
          kind: 'write',
          title: first || wire,
          meta: wire === 'write_file' ? 'written' : wire === 'edit_file' ? 'edited' : 'change set',
        })
        return
      }
      if (wire === 'security_scan' && b.result) {
        out.push({
          index,
          kind: 'verify',
          title: 'Security scan',
          meta: `${b.result.output.split('\n').filter((l) => l.includes('[')).length} finding(s)`,
        })
        return
      }
      if (wire === 'task') {
        out.push({
          index,
          kind: 'research',
          title: String(b.call.input?.task ?? 'subagent'),
          meta: b.result ? 'reported' : 'working',
        })
      }
    }
  })
  return out.reverse()
}

const KIND_MARK: Record<Artifact['kind'], string> = {
  change: '±',
  screenshot: '▣',
  verify: '✓',
  write: '✎',
  research: '⌕',
}

/** how many artifacts there are — the tab's count, without rendering the list */
export function countArtifacts(blocks: Block[]): number {
  return classify(blocks).length
}

export function ArtifactsPanel({ blocks }: { blocks: Block[] }) {
  const artifacts = useMemo(() => classify(blocks), [blocks])

  if (artifacts.length === 0) {
    return (
      <p className="mono px-[14px] py-[12px] text-[11px]" style={{ color: 'var(--text-4)' }}>
        Nothing yet. Changes, screenshots and test reports show up here as the run
        produces them.
      </p>
    )
  }

  return (
    <div className="flex flex-col">
      {artifacts.map((a) => (
        <button
          key={a.index}
          type="button"
          className="mono flex items-baseline gap-[8px] px-[14px] py-[7px] text-left text-[11.5px]"
          style={{ color: 'var(--text-2)' }}
          onClick={() => {
            const el = document.getElementById(`blk-${a.index}`)
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--surface)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <span className="shrink-0" style={{ color: 'var(--text-4)' }}>
            {KIND_MARK[a.kind]}
          </span>
          <span className="min-w-0 flex-1 truncate" title={a.title}>
            {a.title}
          </span>
          <span className="shrink-0" style={{ color: 'var(--text-4)' }}>
            {a.meta}
          </span>
        </button>
      ))}
    </div>
  )
}
