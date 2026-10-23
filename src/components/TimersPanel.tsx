import { useEffect, useState } from 'react'
import { api } from '../lib/api'

/* A timer you cannot see is a timer you do not trust. */
export function TimersPanel() {
  const [rows, setRows] = useState<{ id: string; at: number; title: string; firedAt: number | null }[]>([])

  const load = () => {
    void api
      .timers()
      .then((r) => setRows((r.timers ?? []).filter((t) => !t.consumed)))
      .catch(() => setRows([]))
  }
  useEffect(load, [])

  if (rows.length === 0)
    return (
      <p className="m-0 text-[11.5px]" style={{ color: 'var(--text-4)' }}>
        Nothing scheduled. Ask for one: "check the build in 3 minutes".
      </p>
    )

  return (
    <div className="flex flex-col gap-[4px]">
      {rows.map((t) => {
        const when = new Date(t.at)
        const mins = Math.round((t.at - Date.now()) / 60000)
        return (
          <div
            key={t.id}
            className="flex items-center gap-[8px] rounded-[7px] px-[9px] py-[5px]"
            style={{ border: '1px solid var(--line-1)' }}
          >
            <span className="mono text-[10px]" style={{ color: 'var(--text-3)' }}>
              {when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: 'var(--text-1)' }}>
              {t.title}
            </span>
            <span className="mono text-[9.5px]" style={{ color: 'var(--text-4)' }}>
              {t.firedAt ? 'fired' : mins > 0 ? `in ${mins}m` : 'now'}
            </span>
            <button
              type="button"
              className="ctl rounded-[4px] px-[6px] py-[1px] text-[10px]"
              style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
              onClick={() => void api.cancelTimer(t.id).then(load)}
            >
              cancel
            </button>
          </div>
        )
      })}
    </div>
  )
}
