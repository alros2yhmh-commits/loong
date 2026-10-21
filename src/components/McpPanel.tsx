import { useCallback, useEffect, useState } from 'react'
import {
  api,
  type McpServerSpec,
  type McpServerStatus,
} from '../lib/api'
import { sound } from '../lib/sound'

/* ---------------------------------------------------------------------------
   MCP servers, in Settings.

   This is the one place a person can point the agent at a system it did not
   ship with: a browser's DevTools, a database, a ticket tracker. The list is
   read from the agent, not kept here — the config file is the source of truth,
   and the interface only shows it and edits it.

   A server that will not start says why, in its own row. That is the whole
   difference between a feature and a mystery.
   --------------------------------------------------------------------------- */

const EMPTY = { name: '', command: '', args: '', url: '', readOnly: false }

export function McpPanel() {
  const [servers, setServers] = useState<McpServerStatus[]>([])
  const [config, setConfig] = useState<Record<string, McpServerSpec>>({})
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ ...EMPTY })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [status, cfg] = await Promise.all([api.mcp(), api.mcpConfig()])
    setServers(status.servers)
    setConfig(cfg.mcpServers)
  }, [])

  useEffect(() => {
    void refresh().catch((e) => setError((e as Error).message))
  }, [refresh])

  const add = async () => {
    const name = draft.name.trim()
    if (!name) {
      setError('Give the server a name.')
      return
    }
    const spec: McpServerSpec = draft.url.trim()
      ? {
          url: draft.url.trim(),
          ...(draft.readOnly ? { readOnly: true } : {}),
        }
      : {
          command: draft.command.trim(),
          args: draft.args
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          ...(draft.readOnly ? { readOnly: true } : {}),
        }
    setBusy('new')
    setError(null)
    try {
      const next = { ...config, [name]: spec }
      const result = await api.saveMcp(next)
      setServers(result.servers)
      setConfig(next)
      setDraft({ ...EMPTY })
      setOpen(false)
      sound.play('select')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const test = async (name: string) => {
    setBusy(name)
    setError(null)
    try {
      const status = await api.testMcp(name)
      setServers((prev) => prev.map((s) => (s.name === name ? status : s)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const remove = async (name: string) => {
    setBusy(name)
    setError(null)
    try {
      await api.removeMcp(name)
      const next = { ...config }
      delete next[name]
      setConfig(next)
      setServers((prev) => prev.filter((s) => s.name !== name))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-[8px]">
      {servers.length === 0 && (
        <p className="mono m-0 text-[11px]" style={{ color: 'var(--text-4)' }}>
          No servers yet. Add one below — a command (stdio) or a URL (http/sse).
        </p>
      )}

      {servers.map((s) => (
        <div
          key={s.name}
          className="rounded-[7px] px-[9px] py-[7px]"
          style={{ border: '1px solid var(--line-2)', background: 'var(--surface-sunken)' }}
        >
          <div className="flex items-center gap-[7px]">
            <span
              className="h-[6px] w-[6px] shrink-0 rounded-full"
              style={{ background: s.connected ? 'var(--text-1)' : 'var(--line-4)' }}
            />
            <span className="mono min-w-0 flex-1 truncate text-[11.5px]" style={{ color: 'var(--text-2)' }}>
              {s.name}
            </span>
            <span className="mono shrink-0 text-[10px]" style={{ color: 'var(--text-4)' }}>
              {s.transport}
              {s.connected ? ` · ${s.tools.length} tools` : ''}
            </span>
            <button
              type="button"
              className="ctl shrink-0 rounded-[5px] px-[6px] py-[1px] text-[10px]"
              style={{ border: '1px solid var(--line-2)', color: 'var(--text-4)' }}
              disabled={busy === s.name}
              onClick={() => void test(s.name)}
            >
              {busy === s.name ? '…' : 'test'}
            </button>
            <button
              type="button"
              className="ctl shrink-0 rounded-[5px] px-[6px] py-[1px] text-[10px]"
              style={{ border: '1px solid var(--line-2)', color: 'var(--text-4)' }}
              disabled={busy === s.name}
              onClick={() => void remove(s.name)}
            >
              remove
            </button>
          </div>

          {s.connected && s.tools.length > 0 && (
            <p
              className="mono m-0 mt-[4px] text-[10px] leading-[1.5]"
              style={{ color: 'var(--text-4)' }}
            >
              {s.tools.join(' · ')}
            </p>
          )}

          {s.error && (
            <p className="mono m-0 mt-[4px] text-[10.5px] leading-[1.5]" style={{ color: 'var(--text-3)' }}>
              {s.error}
            </p>
          )}
        </div>
      ))}

      {!open ? (
        <button
          type="button"
          className="ctl self-start rounded-[6px] px-[9px] py-[3px] text-[11px]"
          style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
          onClick={() => setOpen(true)}
        >
          Add server
        </button>
      ) : (
        <div
          className="flex flex-col gap-[6px] rounded-[7px] p-[9px]"
          style={{ border: '1px solid var(--line-3)' }}
        >
          <Field label="Name">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="chrome"
              className="mono w-full bg-transparent text-[11.5px] outline-none"
              style={{ color: 'var(--text-1)' }}
            />
          </Field>
          <Field label="Command">
            <input
              value={draft.command}
              onChange={(e) => setDraft({ ...draft, command: e.target.value })}
              placeholder="npx"
              className="mono w-full bg-transparent text-[11.5px] outline-none"
              style={{ color: 'var(--text-1)' }}
            />
          </Field>
          <Field label="Args (one per line)">
            <textarea
              value={draft.args}
              onChange={(e) => setDraft({ ...draft, args: e.target.value })}
              placeholder={'-y\nchrome-devtools-mcp@latest'}
              rows={2}
              className="mono w-full resize-none bg-transparent text-[11.5px] outline-none"
              style={{ color: 'var(--text-1)' }}
            />
          </Field>
          <Field label="…or URL">
            <input
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              placeholder="http://127.0.0.1:3001/sse"
              className="mono w-full bg-transparent text-[11.5px] outline-none"
              style={{ color: 'var(--text-1)' }}
            />
          </Field>
          <label className="flex items-center gap-[6px] text-[11px]" style={{ color: 'var(--text-3)' }}>
            <input
              type="checkbox"
              checked={draft.readOnly}
              onChange={(e) => setDraft({ ...draft, readOnly: e.target.checked })}
            />
            every tool here only reads — no approval
          </label>
          <div className="flex items-center gap-[6px]">
            <button
              type="button"
              className="ctl rounded-[6px] px-[9px] py-[3px] text-[11px]"
              style={{ background: 'var(--text-1)', color: 'var(--canvas)' }}
              disabled={busy === 'new'}
              onClick={() => void add()}
            >
              {busy === 'new' ? 'connecting…' : 'Add'}
            </button>
            <button
              type="button"
              className="ctl rounded-[6px] px-[9px] py-[3px] text-[11px]"
              style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
              onClick={() => {
                setOpen(false)
                setDraft({ ...EMPTY })
                setError(null)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mono m-0 text-[10.5px] leading-[1.5]" style={{ color: 'var(--text-2)' }}>
          {error}
        </p>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-[8px]">
      <span className="mono w-[86px] shrink-0 text-[10px]" style={{ color: 'var(--text-4)' }}>
        {label}
      </span>
      <span
        className="min-w-0 flex-1 rounded-[4px] px-[5px] py-[2px]"
        style={{ background: 'var(--surface)', border: '1px solid var(--line-2)' }}
      >
        {children}
      </span>
    </label>
  )
}
