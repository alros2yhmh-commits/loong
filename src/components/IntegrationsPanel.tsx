import { useEffect, useState } from 'react'
import { api } from '../lib/api'

/* ---------------------------------------------------------------------------
   The gallery.

   MCP is a JSON file with a command and an env var, and every agent app asks
   the reader to write it. This asks for one click and names the one value the
   server needs, when it needs one.
   --------------------------------------------------------------------------- */

interface Preset {
  id: string
  name: string
  blurb: string
  needs?: string
  docs?: string
}

export function IntegrationsPanel() {
  const [presets, setPresets] = useState<Preset[]>([])
  const [configured, setConfigured] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [token, setToken] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    void api
      .integrations()
      .then((r) => {
        setPresets(r.integrations ?? [])
        setConfigured(r.configured ?? {})
      })
      .catch(() => setError('the agent is not reachable'))
  }
  useEffect(load, [])

  const connect = async (preset: Preset) => {
    setBusy(preset.id)
    setError(null)
    try {
      const value = token[preset.id]?.trim()
      const values = preset.needs ? { [preset.needs]: value ?? '' } : undefined
      const r = await api.connectIntegration(preset.id, values)
      if (!r.ok) setError(r.error ?? 'could not connect')
      load()
    } catch {
      setError('could not reach the agent')
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async (id: string) => {
    setBusy(id)
    try {
      await api.disconnectIntegration(id)
      load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-[7px]">
      {presets.map((preset) => {
        const on = configured[preset.id]
        return (
          <div
            key={preset.id}
            className="rounded-[8px] px-[10px] py-[8px]"
            style={{ border: '1px solid var(--line-2)', background: 'var(--surface-sunken)' }}
          >
            <div className="flex items-center gap-[8px]">
              <span className="text-[12.5px]" style={{ color: 'var(--text-1)' }}>
                {preset.name}
              </span>
              {on && (
                <span className="mono text-[9.5px]" style={{ color: 'var(--text-4)' }}>
                  connected
                </span>
              )}
              <span className="ml-auto flex items-center gap-[5px]">
                {preset.docs && (
                  <a
                    href={preset.docs}
                    target="_blank"
                    rel="noreferrer"
                    className="mono text-[10px]"
                    style={{ color: 'var(--text-4)' }}
                  >
                    docs
                  </a>
                )}
                <button
                  type="button"
                  disabled={busy === preset.id}
                  className="ctl rounded-[5px] px-[8px] py-[3px] text-[11px]"
                  style={{
                    border: '1px solid var(--line-3)',
                    color: on ? 'var(--text-3)' : 'var(--text-1)',
                    opacity: busy === preset.id ? 0.5 : 1,
                  }}
                  onClick={() => (on ? void disconnect(preset.id) : void connect(preset))}
                >
                  {on ? 'Disconnect' : 'Connect'}
                </button>
              </span>
            </div>
            <p className="m-0 mt-[3px] text-[11.5px] leading-[1.5]" style={{ color: 'var(--text-4)' }}>
              {preset.blurb}
            </p>
            {preset.needs && !on && (
              <input
                value={token[preset.id] ?? ''}
                onChange={(e) => setToken((prev) => ({ ...prev, [preset.id]: e.target.value }))}
                placeholder={preset.needs}
                className="mono mt-[6px] w-full rounded-[5px] px-[7px] py-[4px] text-[11px] outline-none"
                style={{
                  border: '1px solid var(--line-2)',
                  background: 'var(--canvas)',
                  color: 'var(--text-1)',
                }}
              />
            )}
          </div>
        )
      })}
      {error && (
        <p className="m-0 text-[11px]" style={{ color: 'var(--text-4)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
