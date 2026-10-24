import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'

/* ---------------------------------------------------------------------------
   Memory, on its own.

   It was a section inside Settings, which made the agent's recollection feel
   like a preference. It is not: it is what the agent knows about you, and it
   deserves the whole window — list, source, and a way to forget.
   --------------------------------------------------------------------------- */

interface Fact {
  id: string
  text: string
  workspace: string | null
  at: number
}

export function MemoryPanel({ onClose }: { onClose: () => void }) {
  const [facts, setFacts] = useState<Fact[]>([])
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    void api
      .memory()
      .then((r) => setFacts(r.entries ?? []))
      .catch(() => setError('the agent is not reachable'))
  }
  useEffect(load, [])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return facts
    return facts.filter((f) => f.text.toLowerCase().includes(needle))
  }, [facts, q])

  /* group by project: a fact about this folder is not a fact about another */
  const groups = useMemo(() => {
    const map = new Map<string, Fact[]>()
    for (const f of shown) {
      const key = f.workspace ? (f.workspace.split(/[\\/]/).filter(Boolean).pop() ?? f.workspace) : 'Everywhere'
      map.set(key, [...(map.get(key) ?? []), f])
    }
    return [...map.entries()].sort(([a], [b]) => (a === 'Everywhere' ? -1 : b === 'Everywhere' ? 1 : a.localeCompare(b)))
  }, [shown])

  const forget = async (id: string) => {
    setFacts((prev) => prev.filter((f) => f.id !== id))
    await api.forgetMemory(id).catch(() => load())
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col" style={{ background: 'var(--canvas)' }}>
      <header
        className="flex h-[46px] shrink-0 items-center gap-[10px] px-[24px]"
        style={{ borderBottom: '1px solid var(--line-1)' }}
      >
        <h2 className="display m-0 flex-1 text-[15px]" style={{ color: 'var(--text-1)' }}>
          Memory
        </h2>
        <span className="mono text-[11px]" style={{ color: 'var(--text-4)' }}>
          {facts.length} {facts.length === 1 ? 'fact' : 'facts'}
        </span>
        <button
          type="button"
          className="ctl rounded-[6px] px-[9px] py-[4px] text-[11.5px]"
          style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
          onClick={onClose}
        >
          Close
        </button>
      </header>

      <div className="px-[24px] pt-[14px]">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search what the agent remembers…"
          className="w-full rounded-[8px] px-[11px] py-[7px] text-[12.5px] outline-none"
          style={{
            border: '1px solid var(--line-2)',
            background: 'var(--surface)',
            color: 'var(--text-1)',
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[24px] pt-[14px] pb-[28px]">
        {error && (
          <p className="m-0 text-[12px]" style={{ color: 'var(--text-3)' }}>
            {error}
          </p>
        )}
        {!error && shown.length === 0 && (
          <div className="max-w-[520px]">
            <p className="m-0 text-[13px] leading-[1.7]" style={{ color: 'var(--text-2)' }}>
              {facts.length === 0
                ? 'Nothing yet. The agent saves a fact when you tell it something worth keeping — a preference, a convention, a decision — and it carries them into every later session.'
                : 'No fact matches that.'}
            </p>
          </div>
        )}

        {groups.map(([project, items]) => (
          <section key={project} className="mb-[22px]">
            <p
              className="mono m-0 mb-[8px] text-[10px] tracking-[0.12em] uppercase"
              style={{ color: 'var(--text-4)' }}
            >
              {project}
            </p>
            <div className="flex flex-col">
              {items.map((f) => (
                <div
                  key={f.id}
                  className="group flex items-start gap-[10px] py-[8px]"
                  style={{ borderTop: '1px solid var(--line-1)' }}
                >
                  <p className="m-0 min-w-0 flex-1 text-[13px] leading-[1.6]" style={{ color: 'var(--text-2)' }}>
                    {f.text}
                  </p>
                  <span className="mono shrink-0 text-[10.5px]" style={{ color: 'var(--text-4)' }}>
                    {new Date(f.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                  </span>
                  <button
                    type="button"
                    className="ctl shrink-0 rounded-[5px] px-[7px] py-[2px] text-[10.5px] opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
                    onClick={() => void forget(f.id)}
                  >
                    Forget
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
