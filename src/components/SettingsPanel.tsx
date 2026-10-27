import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, type ProviderInfo, type Settings } from '../lib/api'
import { useDialogFocus } from '../lib/dialog'

/* ===========================================================================
   Settings.

   The reference's shape: a rail on the left, ONE pane on the right, and the
   switches in the pane. Sixteen chips over one long scroll made every setting
   equally far away; a rail grouped by what the reader is trying to do does not.

   The Keys pane is the one this product could not do without: a provider key
   has to be settable somewhere, and it has to be settable without the interface
   ever being able to read it back.
   =========================================================================== */

/* Three panes. Sound was removed because the product makes no sound; Runtime
   was removed because "connected" is already in the status bar; and the
   provider/model picker moved to the composer, where you are when you need it. */
const RAIL: { group: string; items: [string, string][] }[] = [
  { group: 'General', items: [['appearance', 'Appearance']] },
  { group: 'Model', items: [['keys', 'API keys']] },
  { group: 'Desk', items: [['about', 'About']] },
]

const KEY_ROWS: { id: string; label: string; hint: string }[] = [
  { id: 'openrouter', label: 'OpenRouter', hint: 'One key, most models' },
  { id: 'anthropic', label: 'Anthropic', hint: 'Claude' },
  { id: 'openai', label: 'OpenAI', hint: 'GPT' },
  { id: 'google', label: 'Google', hint: 'Gemini' },
  { id: 'custom', label: 'Custom', hint: 'An OpenAI-compatible endpoint' },
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
  const [direction, setDirection] = useState(() => {
    try { return localStorage.getItem('loong.direction') === 'rtl' ? 'rtl' : 'ltr' }
    catch { return 'ltr' }
  })
  /* the status bar owns "connected"; the prop stays for the shell contract */
  void health
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [keys, setKeys] = useState<Record<string, { set: boolean; hint: string; baseUrl: string }>>({})
  const [storage, setStorage] = useState<{ mode: string; error?: string } | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  /* the endpoint is written as you type, not on blur: closing the panel with the
     caret still in the field used to discard it */
  const [urlDraft, setUrlDraft] = useState<Record<string, string>>({})
  const urlTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  /* a save either worked or it did not, and the reader is told which */
  const [saved, setSaved] = useState<{ id: string; ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!open) return
    void api.providers().then((r) => setProviders(r.providers ?? [])).catch(() => {})
    void api.keys().then((r) => { setKeys(r.keys ?? {}); setStorage(r.storage ?? null) }).catch(() => {})
  }, [open, settings.provider])

  /* Escape is the way out of every surface in this app; the panel was the one
     that did not listen, so a keyboard user was trapped until they found Close */
  const panel = useRef<HTMLDivElement>(null)
  useDialogFocus(open, panel, onClose)

  if (!open) return null

  const saveKey = async (id: string) => {
    const value = draft[id] ?? ''
    try {
      const r = await api.putKeys({ keys: { [id]: value } })
      setKeys(r.keys)
      setStorage(r.storage ?? null)
      setDraft((d) => ({ ...d, [id]: '' }))
      setSaved({ id, ok: true, text: 'saved — the agent can use it now' })
    } catch (err) {
      /* a silent catch is a lie by omission: the reader would keep believing
         the key was stored */
      setSaved({ id, ok: false, text: `not saved — ${(err as Error).message}` })
    }
    setTimeout(() => setSaved(null), 4000)
  }

  const saveBaseUrl = async (id: string, url: string) => {
    try {
      const r = await api.putKeys({ baseUrls: { [id]: url } })
      setKeys(r.keys)
      setStorage(r.storage ?? null)
      setSaved({ id: `${id}-url`, ok: true, text: 'endpoint saved' })
    } catch (err) {
      setSaved({ id: `${id}-url`, ok: false, text: `not saved — ${(err as Error).message}` })
    }
    setTimeout(() => setSaved(null), 4000)
  }

  return (
    <div
      className="absolute inset-0 z-[60] grid place-items-center"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={onClose}
    >
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        initial={{ opacity: 0, y: 10, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, transition: { duration: 0.2, ease: 'easeIn' } }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="flex h-[78vh] w-[900px] max-w-[94vw] flex-col overflow-hidden rounded-[16px]"
        style={{ background: 'var(--canvas)', border: '1px solid var(--line-3)', boxShadow: 'var(--shadow-modal)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-[20px] py-[14px]">
          <h2 className="display m-0 t-h3">Settings</h2>
          <button
            type="button"
            className="ctl rounded-[7px] px-[10px] py-[5px] t-small"
            style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <div className="rule-engraved" />

        <div className="flex min-h-0 flex-1">
          <nav
            className="flex w-[210px] shrink-0 flex-col overflow-y-auto px-[10px] py-[12px]"
            style={{ borderRight: '1px solid var(--line-1)' }}
          >
            {RAIL.map(({ group, items }) => (
              <div key={group} className="mb-[10px]">
                <p className="mono m-0 px-[9px] pb-[5px] t-tiny tracking-[0.12em] uppercase" style={{ color: 'var(--text-4)' }}>
                  {group}
                </p>
                {items.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-current={pane === id ? 'page' : undefined}
                    className="ctl w-full rounded-[7px] px-[9px] py-[6px] text-left t-small"
                    style={{
                      color: pane === id ? 'var(--text-1)' : 'var(--text-3)',
                      background: pane === id ? 'var(--surface-selected)' : 'transparent',
                      fontWeight: pane === id ? 500 : 400,
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
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={pane}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="px-[26px] pt-[18px] pb-[30px]"
              >
                {pane === 'appearance' && (
                  <>
                    <h3 className="display m-0 t-h3">Appearance</h3>
                    <p className="mt-[5px] mb-[18px] t-small leading-[1.65]" style={{ color: 'var(--text-3)' }}>
                      One ink, one canvas. Every surface is white and the ink is black — the only grey
                      is the selection, which is grey so it marks a region without becoming content.
                    </p>
                    <Row label="Thread text" hint="The size of the conversation, in pixels.">
                      <div className="flex items-center gap-[12px]">
                        <input
                          type="range"
                          min={11}
                          max={24}
                          value={settings.fontSize}
                          onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
                          aria-label="Thread text size"
                          className="flex-1"
                        />
                        <span className="mono t-small" style={{ color: 'var(--text-3)' }}>
                          {settings.fontSize}px
                        </span>
                      </div>
                    </Row>
                    <Row label="Reduced motion" hint="Opacity only. Nothing depends on movement.">
                      <Switch
                        on={settings.reducedMotion}
                        onChange={(v) => onChange({ reducedMotion: v })}
                        label="Reduced motion"
                      />
                    </Row>
                    <Row label="Layout direction" hint="Use a right-to-left workspace for Arabic. Code, paths and terminal output keep their left-to-right direction.">
                      <select aria-label="Layout direction" value={direction}
                        className="rounded-[7px] px-[10px] py-[6px] t-small"
                        style={{ background: 'var(--raised)', border: '1px solid var(--line-2)' }}
                        onChange={(event) => {
                          const value = event.target.value
                          setDirection(value)
                          try { localStorage.setItem('loong.direction', value) } catch { /* local preference only */ }
                          window.dispatchEvent(new Event('loong-direction'))
                        }}>
                        <option value="ltr">Left to right</option>
                        <option value="rtl">العربية — من اليمين لليسار</option>
                      </select>
                    </Row>
                  </>
                )}

                {pane === 'keys' && (
                  <>
                    <h3 className="display m-0 t-h3">API keys</h3>
                    <p className="mt-[5px] mb-[18px] t-small leading-[1.65]" style={{ color: 'var(--text-3)' }}>
                      Provider keys are held by the local agent. Saved values are returned only as masked status.
                    </p>
                    {storage && <p className="t-small mb-[14px]" role={storage.mode === 'unavailable' ? 'alert' : 'status'} style={{ color: storage.mode === 'encrypted' ? 'var(--text-3)' : 'var(--amber)' }}>
                      {storage.mode === 'encrypted' ? "Stored with this device's keychain-backed encryption."
                        : storage.mode === 'unavailable' ? storage.error ?? 'Credential storage is locked. Existing values were preserved.'
                        : 'Local credential storage is not encrypted on this device. Enable an OS keychain for desktop encryption.'}
                    </p>}
                    <Row label="Provider" hint="Where the model runs. The key below belongs to it.">
                      <div className="flex flex-wrap gap-[5px]">
                        {providers.map((pr) => (
                          <button
                            key={pr.id}
                            type="button"
                            aria-label={`Select ${pr.label} as the provider`}
                            aria-pressed={settings.provider === pr.id}
                            className="ctl rounded-[7px] px-[11px] py-[5px] t-small"
                            style={{
                              border: `1px solid ${settings.provider === pr.id ? 'var(--line-4)' : 'var(--line-2)'}`,
                              color: settings.provider === pr.id ? 'var(--text-1)' : 'var(--text-2)',
                              background: settings.provider === pr.id ? 'var(--selected)' : 'transparent',
                            }}
                            onClick={() => onChange({ provider: pr.id })}
                          >
                            {pr.label}
                          </button>
                        ))}
                      </div>
                    </Row>

                    {KEY_ROWS.map((k) => {
                      const status = keys[k.id] ?? { set: false, hint: '' }
                      return (
                        <div
                          key={k.id}
                          className="flex flex-col gap-[7px] py-[12px]"
                          style={{ borderTop: '1px solid var(--line-1)' }}
                        >
                          <div className="flex items-baseline gap-[8px]">
                            <span className="t-small" style={{ color: 'var(--text-1)' }}>
                              {k.label}
                            </span>
                            <span className="t-tiny" style={{ color: 'var(--text-4)' }}>
                              {k.hint}
                            </span>
                            <span className="flex-1" />
                            {status.set ? (
                              <span className="mono t-tiny" style={{ color: 'var(--text-2)' }}>
                                {status.hint}
                              </span>
                            ) : (
                              <span className="t-tiny" style={{ color: 'var(--text-4)' }}>
                                not set
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-[8px]">
                            <input
                              type="password"
                              value={draft[k.id] ?? ''}
                              onChange={(e) => setDraft((d) => ({ ...d, [k.id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void saveKey(k.id)
                              }}
                              placeholder={status.set ? 'replace the key…' : 'paste the key…'}
                              aria-label={`${k.label} API key`}
                              autoComplete="off"
                              className="min-w-0 flex-1 rounded-[8px] px-[11px] py-[7px] mono t-small outline-none"
                              style={{ border: '1px solid var(--line-2)' }}
                            />
                            <button
                              type="button"
                              className="ctl rounded-[8px] px-[12px] py-[6px] t-small"
                              style={{ background: 'var(--btn-primary)', color: 'var(--btn-primary-text)' }}
                              onClick={() => void saveKey(k.id)}
                            >
                              Save
                            </button>
                            {status.set && (
                              <button
                                type="button"
                                className="ctl rounded-[8px] px-[11px] py-[6px] t-small"
                                style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
                                onClick={() => {
                                  setDraft((d) => ({ ...d, [k.id]: '' }))
                                  void api.putKeys({ keys: { [k.id]: '' } }).then((r) => setKeys(r.keys)).catch(() => {})
                                }}
                              >
                                Clear
                              </button>
                            )}
                          </div>
                          {/* a custom provider is a key AND an endpoint */}
                          {k.id === 'custom' && (
                            <div className="flex items-center gap-[8px]">
                              <input
                                value={urlDraft[k.id] ?? status.baseUrl}
                                onChange={(e) => {
                                  const v = e.target.value
                                  setUrlDraft((d) => ({ ...d, [k.id]: v }))
                                  clearTimeout(urlTimers.current[k.id])
                                  urlTimers.current[k.id] = setTimeout(() => void saveBaseUrl(k.id, v), 500)
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void saveBaseUrl(k.id, (e.target as HTMLInputElement).value)
                                }}
                                placeholder="https://your-endpoint/v1"
                                aria-label="Custom provider base URL"
                                className="mono min-w-0 flex-1 rounded-[8px] px-[11px] py-[7px] t-small outline-none"
                                style={{ border: '1px solid var(--line-2)' }}
                              />
                            </div>
                          )}
                          {saved?.id === k.id && (
                            <motion.span
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className="t-tiny"
                              style={{ color: saved.ok ? 'var(--text-2)' : 'var(--text-1)' }}
                            >
                              {saved.text}
                            </motion.span>
                          )}
                        </div>
                      )
                    })}
                  </>
                )}

                {pane === 'about' && (
                  <>
                    <h3 className="display m-0 t-h3">About</h3>
                    <p className="mt-[5px] mb-[18px] t-small leading-[1.65]" style={{ color: 'var(--text-3)' }}>
                      One brain, real tools, an interface built to be read.
                    </p>
                    <Row label="Version">
                      <span className="mono t-small">{__APP_VERSION__}</span>
                    </Row>
                    <Row label="Built by">
                      <span className="t-small">Professor Hamza Mahmoud Ramadan</span>
                    </Row>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <div className="rule-engraved" />
        <footer className="px-[20px] py-[10px]">
          <p className="mono m-0 t-tiny" style={{ color: 'var(--text-4)' }}>
            Loong {__APP_VERSION__} · built by Professor Hamza Mahmoud Ramadan
          </p>
        </footer>
      </motion.div>
    </div>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-[16px] py-[11px]" style={{ borderTop: '1px solid var(--line-1)' }}>
      <div className="w-[124px] shrink-0">
        <span className="block t-small" style={{ color: 'var(--text-1)' }}>
          {label}
        </span>
        {hint && (
          <span className="mt-[2px] block t-tiny leading-[1.5]" style={{ color: 'var(--text-4)' }}>
            {hint}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="switch"
      data-on={on}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  )
}
