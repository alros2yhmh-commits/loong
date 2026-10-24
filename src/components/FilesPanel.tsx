import { useEffect, useState } from 'react'
import { api } from '../lib/api'

/* ---------------------------------------------------------------------------
   The workspace, visible.

   An agent that edits files while the reader cannot see which files exist is
   an agent asking for trust it has not earned. This is the tree, read-only:
   what is here, how deep, and what the run is working inside.
   --------------------------------------------------------------------------- */

interface Node {
  name: string
  dir: boolean
  children?: Node[]
}

function Row({ node, depth }: { node: Node; depth: number }) {
  const [open, setOpen] = useState(depth === 0)
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-[5px] rounded-[4px] px-[4px] py-[2px] text-left"
        style={{ paddingLeft: 4 + depth * 11 }}
        onClick={() => node.dir && setOpen((v) => !v)}
      >
        <span
          className="mono text-[10px]"
          style={{ color: 'var(--text-4)', width: 9 }}
        >
          {node.dir ? (open ? '-' : '+') : ''}
        </span>
        <span
          className="mono min-w-0 flex-1 truncate text-[10.5px]"
          style={{ color: node.dir ? 'var(--text-2)' : 'var(--text-3)' }}
        >
          {node.name}
          {node.dir ? '/' : ''}
        </span>
      </button>
      {node.dir && open && node.children?.map((child) => (
        <Row key={`${node.name}/${child.name}`} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

export function FilesPanel() {
  const [tree, setTree] = useState<Node[]>([])
  const [root, setRoot] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api
      .tree(2)
      .then((r) => {
        setTree((r.tree ?? []) as Node[])
        setRoot(r.root ?? '')
        setError(r.error ?? null)
      })
      .catch(() => setError('the agent is not reachable'))
  }, [])

  if (error)
    return (
      <p className="px-[10px] py-[8px] text-[11px]" style={{ color: 'var(--text-4)' }}>
        {error}
      </p>
    )

  return (
    <div className="flex h-full flex-col">
      <p className="mono truncate px-[10px] pt-[6px] pb-[4px] text-[10px]" style={{ color: 'var(--text-4)' }} title={root}>
        {root}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-[6px] pb-[8px]">
        {tree.length === 0 ? (
          <p className="px-[6px] py-[6px] text-[11px]" style={{ color: 'var(--text-4)' }}>
            Empty folder.
          </p>
        ) : (
          tree.map((n) => <Row key={n.name} node={n} depth={0} />)
        )}
      </div>
    </div>
  )
}
