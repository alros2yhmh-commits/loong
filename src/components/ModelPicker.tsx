import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { api, type ModelInfo, type ProviderInfo } from '../lib/api'
import { loadModelCatalog } from '../lib/model-catalog'
import { useDialogFocus } from '../lib/dialog'

/* ===========================================================================
   The model picker, in the composer.

   It used to be a chip that opened Settings — a picker that sends you to
   another screen is not a picker. This one is the list, right here, with a
   search field and a final row that lets you type any model name the provider
   accepts, because a catalogue is never complete.

   A local ollama answers with `name`; a hosted provider answers with `id`. Both
   are accepted, because the interface should not care which one answered.
   =========================================================================== */

export function ModelPicker({
  open,
  current,
  provider,
  route = 'manual',
  onClose,
  onPick,
  onProvider,
  onRoute,
}: {
  open: boolean
  current: string
  provider: string
  route?: 'auto' | 'manual'
  onClose: () => void
  onPick: (model: string) => void
  onProvider: (id: string) => void
  onRoute?: (route: 'auto' | 'manual') => void
}) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [q, setQ] = useState('')
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  useDialogFocus(open, dialog, onClose)

  useEffect(() => {
    if (!open) return
    let active = true
    setQ('')
    setCustom('')
    setBusy(true)
    setError(null)
    setModels([])
    setStale(false)
    void api.providers().then((r) => { if (active) setProviders(r.providers ?? []) }).catch(() => {})
    void loadModelCatalog(provider)
      .then((r) => {
        if (!active) return
        setModels(r.models)
        setError(r.error ?? null)
        setStale(r.stale === true)
      })
      .catch((e) => { if (active) setError((e as Error).message) })
      .finally(() => { if (active) setBusy(false) })
    const focus = requestAnimationFrame(() => input.current?.focus())
    return () => { active = false; cancelAnimationFrame(focus) }
  }, [open, provider])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? models.filter((m) => `${m.id} ${m.name ?? ''}`.toLowerCase().includes(needle))
      : models
    return list.slice(0, 80)
  }, [models, q])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[76]" onMouseDown={onClose}>
      <motion.div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Choose a model"
        tabIndex={-1}
        initial={{ opacity: 0, y: 6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="absolute w-[min(420px,calc(100vw-24px))] overflow-hidden rounded-[14px]"
        style={{
          right: 16,
          bottom: 92,
          background: 'var(--canvas)',
          border: '1px solid var(--line-3)',
          boxShadow: 'var(--shadow-modal)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-[10px] p-[10px]" style={{ borderBottom: '1px solid var(--line-1)' }}>
          <span className="t-small" style={{ color: 'var(--text-1)' }}>Model selection</span>
          <button type="button" className="ctl rounded-[6px] px-[7px] t-small" onClick={onClose} aria-label="Close model picker">×</button>
        </div>
        <div className="flex flex-wrap gap-[3px] p-[7px]" style={{ borderBottom: '1px solid var(--line-1)' }}>
          {providers.map((pr) => (
            <button
              key={pr.id}
              type="button"
              aria-label={`Use ${pr.label}`}
              aria-pressed={provider === pr.id}
              className="ctl rounded-[6px] px-[8px] py-[3px] t-tiny"
              style={{
                border: `1px solid ${provider === pr.id ? 'var(--line-4)' : 'transparent'}`,
                background: provider === pr.id ? 'var(--selected)' : 'transparent',
                color: provider === pr.id ? 'var(--text-1)' : 'var(--text-3)',
              }}
              onClick={() => onProvider(pr.id)}
            >
              {pr.label}
            </button>
          ))}
        </div>

        {onRoute && (
          <div className="px-[10px] py-[8px]" style={{ borderBottom: '1px solid var(--line-1)' }}>
            <div role="group" aria-label="Model routing" className="flex gap-[5px]">
              {(['manual', 'auto'] as const).map((choice) => (
                <button key={choice} type="button" aria-pressed={route === choice}
                  className="ctl rounded-[6px] px-[9px] py-[4px] t-small"
                  style={{ background: route === choice ? 'var(--surface-selected)' : 'transparent', border: '1px solid var(--line-2)' }}
                  onClick={() => onRoute(choice)}>
                  {choice === 'manual' ? 'Fixed model' : 'Auto fallback'}
                </button>
              ))}
            </div>
            <p className="m-0 mt-[6px] t-tiny leading-[1.5]" style={{ color: 'var(--text-3)' }}>
              {route === 'manual' ? 'Keep the selected model. Retry errors without switching models.' : 'Allow compatible free alternatives when a free OpenRouter model is unavailable. Paid models stay fixed.'}
            </p>
          </div>
        )}

        <div className="p-[8px]" style={{ borderBottom: '1px solid var(--line-1)' }}>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'Enter' && shown[0]) {
                const m = shown[0]
                onPick(m.id ?? m.name ?? '')
                onClose()
              }
            }}
            placeholder="Search models…"
            aria-label="Search models"
            className="w-full rounded-[8px] px-[10px] py-[6px] t-small outline-none"
            style={{ border: '1px solid var(--line-2)' }}
          />
        </div>

        <div className="max-h-[280px] overflow-y-auto p-[5px]">
          {busy && (
            <p className="m-0 px-[9px] py-[10px] t-small" style={{ color: 'var(--text-3)' }}>
              reading the models…
            </p>
          )}
          {error && (
            <p role="status" className="m-0 px-[9px] py-[10px] t-small" style={{ color: 'var(--text-1)' }}>
              {error}. You can still enter a model ID below.
            </p>
          )}
          {stale && <p role="status" className="m-0 px-[9px] py-[6px] t-tiny" style={{ color: 'var(--amber)' }}>Showing a cached model list; live availability may have changed.</p>}
          {!busy && !error && shown.length === 0 && (
            <p className="m-0 px-[9px] py-[10px] t-small" style={{ color: 'var(--text-3)' }}>
              {provider === 'custom' ? 'Enter the model ID used by your endpoint below.' : 'No models found. Enter a model ID below.'}
            </p>
          )}
          {shown.map((m) => {
            const name = m.id ?? m.name ?? ''
            return (
              <button
                key={name}
                type="button"
                className="ctl flex w-full items-center gap-[8px] rounded-[8px] px-[9px] py-[6px] text-left"
                style={{ background: current === name ? 'var(--surface-selected)' : 'transparent' }}
                onClick={() => {
                  onPick(name)
                  onClose()
                }}
              >
                <span className="mono min-w-0 flex-1 truncate t-small" style={{ color: 'var(--text-1)' }}>
                  {name}
                </span>
                {m.supportsTools === true || m.tools === true ? <span className="t-tiny shrink-0" style={{ color: 'var(--text-3)' }}>Tools</span> : null}
                {m.free && <span className="t-tiny shrink-0" style={{ color: 'var(--ok)' }}>Free</span>}
                {m.vision && <span className="t-tiny shrink-0" style={{ color: 'var(--text-3)' }} title="Accepts images">Images</span>}
                {m.reasoning && <span className="t-tiny shrink-0" style={{ color: 'var(--text-3)' }} title="Reasoning model">Reasoning</span>}
                {m.context ? (
                  <span className="t-tiny shrink-0" style={{ color: 'var(--text-4)' }}>
                    {Math.round(m.context / 1000)}k context
                  </span>
                ) : null}
                {current === name && <span style={{ color: 'var(--text-1)' }}>✓</span>}
              </button>
            )
          })}
        </div>

        {/* the last row: any name the provider accepts */}
        <div className="p-[8px]" style={{ borderTop: '1px solid var(--line-1)' }}>
          <p className="mono m-0 mb-[5px] t-tiny tracking-[0.1em] uppercase" style={{ color: 'var(--text-4)' }}>
            Model ID
          </p>
          <div className="flex items-center gap-[6px]">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && custom.trim()) {
                  onPick(custom.trim())
                  onClose()
                }
              }}
              placeholder="provider/model-id"
              dir="ltr"
              autoCapitalize="none"
              spellCheck={false}
              aria-label="Custom model name"
              className="mono min-w-0 flex-1 rounded-[8px] px-[9px] py-[5px] t-small outline-none"
              style={{ border: '1px solid var(--line-2)' }}
            />
            <button
              type="button"
              disabled={!custom.trim()}
              className="ctl rounded-[8px] px-[10px] py-[5px] t-small"
              style={{ background: 'var(--btn-primary)', color: 'var(--btn-primary-text)', opacity: custom.trim() ? 1 : 0.4 }}
              onClick={() => {
                if (!custom.trim()) return
                onPick(custom.trim())
                onClose()
              }}
            >
              Use
            </button>
          </div>
          <p className="m-0 mt-[6px] t-tiny leading-[1.5]" style={{ color: 'var(--text-3)' }}>
            Manually entered IDs use the provider’s capabilities. Verify tool support for coding tasks; a model name alone does not establish it.
          </p>
        </div>
      </motion.div>
    </div>
  )
}
