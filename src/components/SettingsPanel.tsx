import { useEffect, useState } from 'react'
import { api, type ModelInfo, type ProviderInfo, type Settings } from '../lib/api'

/* ===========================================================================
   Settings — a rail and one pane at a time.

   Sixteen chips over one long scroll made every setting equally far away. The
   rail groups them by the reader's mental model (Everyday / Model / Desk), and
   the body shows ONE pane. Memory is not here: it is a place, not a preference,
   and it has its own screen.
   =========================================================================== */

const GROUPS: { group: string; items: [string, string][] }[] = [
  { group: 'Everyday', items: [['appearance', 'Look'], ['sound', 'Sound']] },
  { group: 'Model', items: [['runtime', 'Runtime'], ['provider', 'Model']] },
  { group: 'Desk', items: [['about', 'About']] },
]

export function SettingsPanel({
  open,
  onClose,
  settings,
  onChange,
  health,
}: {
  open: boolean
  onClose: () => void
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  health: boolean | null
}) {
  const [pane, setPane] = useState('appearance')
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [catalog, setCatalog] = useState<ModelInfo[]>([])
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open) return
    void api.providers().then((r) => setProviders(r.providers ?? [])).catch(() => {})
    void api.models().then((r) => setModels(r.models ?? [])).catch(() => {})
    void api.catalog().then((r) => setCatalog(r.models ?? [])).catch(() => {})
  }, [open, settings.provider])

  if (!open) return null

  const shown = (() => {
    const needle = q.trim().toLowerCase()
    const pool = models.length ? models : catalog
    if (!needle) return pool.slice(0, 60)
    return pool.filter((m) => m.id.toLowerCase().includes(needle)).slice(0, 60)
  })()

  return (
    <div
      className="absolute inset-0 z-[60] grid place-items-center"
      style={{ background: 'rgba(0,0,0,0.32)' }}
      onMouseDown={onClose}
    >
      <div
        className="flex h-[76vh] w-[880px] max-w-[94vw] flex-col overflow-hidden rounded-[16px]"
        style={{ background: 'var(--canvas)', border: '1px solid var(--line-4)', boxShadow: 'var(--shadow-modal)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-[18px] py-[13px]">
          <h2 className="display m-0 t-h3">Settings</h2>
          <button
            type="button"
            className="ctl rounded-[6px] px-[9px] py-[4px] t-small"
            style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <div className="rule-engraved" />

        <div className="flex min-h-0 flex-1">
          <nav className="flex w-[196px] shrink-0 flex-col overflow-y-auto px-[10px] py-[12px]" style={{ borderRight: '1px solid var(--line-1)' }}>
            {GROUPS.map(({ group, items }) => (
              <div key={group} className="mb-[8px]">
                <p className="mono m-0 px-[8px] pb-[4px] t-tiny tracking-[0.12em] uppercase" style={{ color: 'var(--text-4)' }}>
                  {group}
                </p>
                {items.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className="ctl w-full rounded-[7px] px-[9px] py-[6px] text-left t-small"
                    style={{
                      color: pane === id ? 'var(--text-1)' : 'var(--text-3)',
                      background: pane === id ? 'var(--surface-selected)' : 'transparent',
                      border: pane === id ? '1px solid var(--line-2)' : '1px solid transparent',
                    }}
                    onClick={() => setPane(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {pane === 'appearance' && (
              <section className="px-[24px] pt-[18px] pb-[26px]">
                <h3 className="display m-0 t-h3">Look</h3>
                <p className="mt-[4px] mb-[16px] t-small leading-[1.6]" style={{ color: 'var(--text-3)' }}>
                  One warm monochrome ramp, twelve perceptually even steps, the same hairlines
                  everywhere, and no accent colour to configure. Every surface is white and the ink
                  is black — the only grey in the app is the selection, which is grey so it marks a
                  region without becoming content.
                </p>
                <Row label="Thread text">
                  <input
                    type="range"
                    min={11}
                    max={20}
                    value={settings.fontSize}
                    onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
                    aria-label="Thread text size"
                  />
                  <span className="t-small" style={{ color: 'var(--text-3)' }}>{settings.fontSize}px</span>
                </Row>
              </section>
            )}

            {pane === 'sound' && (
              <section className="px-[24px] pt-[18px] pb-[26px]">
                <h3 className="display m-0 t-h3">Sound</h3>
                <p className="mt-[4px] mb-[16px] t-small leading-[1.6]" style={{ color: 'var(--text-3)' }}>
                  A very quiet click when the agent finishes. Off by default.
                </p>
                <Row label="Enabled">
                  <button
                    type="button"
                    className="ctl rounded-[7px] px-[11px] py-[5px] t-small"
                    style={{ border: '1px solid var(--line-3)', color: 'var(--text-1)' }}
                    onClick={() => onChange({ soundEnabled: !settings.soundEnabled })}
                  >
                    {settings.soundEnabled ? 'On' : 'Off'}
                  </button>
                </Row>
                <Row label="Volume">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(settings.volume * 100)}
                    onChange={(e) => onChange({ volume: Number(e.target.value) / 100 })}
                    aria-label="Volume"
                  />
                </Row>
              </section>
            )}

            {pane === 'runtime' && (
              <section className="px-[24px] pt-[18px] pb-[26px]">
                <h3 className="display m-0 t-h3">Runtime</h3>
                <p className="mt-[4px] mb-[16px] t-small leading-[1.6]" style={{ color: 'var(--text-3)' }}>
                  The agent is a separate local process. It is the only thing that ever sees an API
                  key, and the key never reaches this window.
                </p>
                <Row label="Status">
                  <span className="t-small" style={{ color: 'var(--text-2)' }}>
                    {health === null ? 'checking…' : health ? 'connected' : 'not running'}
                  </span>
                </Row>
                <Row label="Default mode">
                  <div className="flex gap-[6px]">
                    {(['ask', 'plan', 'agent'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        className="ctl rounded-[7px] px-[11px] py-[5px] t-small"
                        style={{
                          border: `1px solid ${settings.mode === m ? 'var(--line-4)' : 'var(--line-2)'}`,
                          color: 'var(--text-1)',
                        }}
                        onClick={() => onChange({ mode: m })}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </Row>
              </section>
            )}

            {pane === 'provider' && (
              <section className="px-[24px] pt-[18px] pb-[26px]">
                <h3 className="display m-0 t-h3">Model</h3>
                <p className="mt-[4px] mb-[16px] t-small leading-[1.6]" style={{ color: 'var(--text-3)' }}>
                  The route picks per run unless you pin one. A catalogue search beats a 322-row
                  dropdown.
                </p>
                <Row label="Provider">
                  <div className="flex flex-wrap gap-[5px]">
                    {providers.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        aria-label={`Select ${p.label} as the model provider`}
                        aria-pressed={settings.provider === p.id}
                        className="ctl rounded-[6px] px-[10px] py-[5px] t-small"
                        style={{
                          border: `1px solid ${settings.provider === p.id ? 'var(--line-4)' : 'var(--line-2)'}`,
                          color: 'var(--text-1)',
                        }}
                        onClick={() => onChange({ provider: p.id, model: '' })}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </Row>
                <Row label="Model">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search the catalogue…"
                    aria-label="Search the catalogue"
                    className="w-full rounded-[8px] px-[10px] py-[6px] t-small outline-none"
                    style={{ border: '1px solid var(--line-2)' }}
                  />
                  <div className="mt-[8px] flex max-h-[260px] flex-col overflow-y-auto">
                    {shown.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="ctl rounded-[6px] px-[9px] py-[5px] text-left"
                        style={{
                          background: settings.model === m.id ? 'var(--surface-selected)' : 'transparent',
                        }}
                        onClick={() => onChange({ model: m.id })}
                      >
                        <span className="mono block truncate t-small" style={{ color: 'var(--text-1)' }}>
                          {m.id}
                        </span>
                        {m.context && (
                          <span className="block t-tiny" style={{ color: 'var(--text-4)' }}>
                            {Math.round(m.context / 1000)}k context{m.vision ? ' · images' : ''}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </Row>
              </section>
            )}

            {pane === 'about' && (
              <section className="px-[24px] pt-[18px] pb-[26px]">
                <h3 className="display m-0 t-h3">About</h3>
                <p className="mt-[4px] mb-[16px] t-small leading-[1.6]" style={{ color: 'var(--text-3)' }}>
                  Loong (龙) — one brain, real tools, a UI built to be read.
                </p>
                <Row label="Version"><span className="t-small">1.0.0</span></Row>
                <Row label="Built by"><span className="t-small">Professor Hamza Mahmoud Ramadan</span></Row>
              </section>
            )}
          </div>
        </div>

        <div className="rule-engraved" />
        <footer className="px-[18px] py-[10px]">
          <p className="mono m-0 t-tiny" style={{ color: 'var(--text-4)' }}>
            Loong (龙) 1.0.0 · built by Professor Hamza Mahmoud Ramadan
          </p>
        </footer>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-[14px] py-[8px]" style={{ borderTop: '1px solid var(--line-1)' }}>
      <span className="w-[104px] shrink-0 t-small" style={{ color: 'var(--text-3)' }}>
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
