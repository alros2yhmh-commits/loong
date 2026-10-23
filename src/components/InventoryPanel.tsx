import { useEffect, useState } from 'react'
import { api } from '../lib/api'

/* ---------------------------------------------------------------------------
   What the agent knows, visible.

   A skill system nobody can see is a skill system nobody trusts. These two
   panels show the skills that exist (and what triggers each) and the library
   the model can open — the inventory, not a promise.
   --------------------------------------------------------------------------- */

type SkillRow = { name: string; description: string; triggers: string[]; chars: number; source: string }
type TopicRow = { id: string; title: string; summary: string; chars: number }

export function SkillsPanel() {
  const [rows, setRows] = useState<SkillRow[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [body, setBody] = useState<string>('')

  useEffect(() => {
    void api.skills().then((r) => setRows(r.skills ?? [])).catch(() => setRows([]))
  }, [])

  if (rows.length === 0)
    return (
      <p className="m-0 text-[11.5px]" style={{ color: 'var(--text-4)' }}>
        No skills yet. The agent writes one with learn_skill when it works something out.
      </p>
    )

  return (
    <div className="flex flex-col gap-[5px]">
      {rows.map((s) => (
        <div key={s.name} className="rounded-[7px] px-[9px] py-[6px]" style={{ border: '1px solid var(--line-1)' }}>
          <button
            type="button"
            className="flex w-full items-center gap-[7px] text-left"
            onClick={() => {
              if (open === s.name) {
                setOpen(null)
                return
              }
              setOpen(s.name)
              setBody('…')
              void api.skill(s.name).then((r) => setBody(r.body ?? '')).catch(() => setBody(''))
            }}
          >
            <span className="mono text-[11.5px]" style={{ color: 'var(--text-1)' }}>
              {s.name}
            </span>
            <span className="mono text-[9.5px]" style={{ color: 'var(--text-4)' }}>
              {s.source}
            </span>
            <span className="ml-auto mono text-[10px]" style={{ color: 'var(--text-4)' }}>
              {(s.chars / 1000).toFixed(1)}k
            </span>
          </button>
          <p className="m-0 mt-[2px] text-[11px] leading-[1.45]" style={{ color: 'var(--text-3)' }}>
            {s.description}
          </p>
          {s.triggers.length > 0 && (
            <p className="mono m-0 mt-[3px] text-[9.5px]" style={{ color: 'var(--text-4)' }}>
              triggers: {s.triggers.join(' · ')}
            </p>
          )}
          {open === s.name && body && (
            <pre
              className="mono mt-[5px] max-h-[160px] overflow-auto whitespace-pre-wrap rounded-[5px] p-[6px] text-[10px]"
              style={{ background: 'var(--surface-sunken)', color: 'var(--text-3)' }}
            >
              {body}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}

export function LibraryPanel() {
  const [rows, setRows] = useState<TopicRow[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [body, setBody] = useState<string>('')

  useEffect(() => {
    void api.libraryTopics().then((r) => setRows(r.topics ?? [])).catch(() => setRows([]))
  }, [])

  return (
    <div className="flex flex-col gap-[4px]">
      {rows.map((t) => (
        <div key={t.id} className="rounded-[7px] px-[9px] py-[5px]" style={{ border: '1px solid var(--line-1)' }}>
          <button
            type="button"
            className="flex w-full items-center gap-[7px] text-left"
            onClick={() => {
              if (open === t.id) {
                setOpen(null)
                return
              }
              setOpen(t.id)
              setBody('…')
              void api
                .libraryTopic(t.id)
                .then((r) => setBody((r as { body?: string }).body ?? ''))
                .catch(() => setBody(''))
            }}
          >
            <span className="mono text-[11.5px]" style={{ color: 'var(--text-1)' }}>
              {t.id}
            </span>
            <span className="mono ml-auto text-[10px]" style={{ color: 'var(--text-4)' }}>
              {(t.chars / 1000).toFixed(1)}k
            </span>
          </button>
          <p className="m-0 mt-[1px] text-[11px] leading-[1.4]" style={{ color: 'var(--text-4)' }}>
            {t.summary}
          </p>
          {open === t.id && body && (
            <pre
              className="mono mt-[5px] max-h-[200px] overflow-auto whitespace-pre-wrap rounded-[5px] p-[6px] text-[10px]"
              style={{ background: 'var(--surface-sunken)', color: 'var(--text-3)' }}
            >
              {body}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
