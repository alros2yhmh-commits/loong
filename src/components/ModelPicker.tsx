import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { api, type ModelInfo } from '../lib/api'

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
  onClose,
  onPick,
}: {
  open: boolean
  current: string
  onClose: () => void
  onPick: (model: string) => void
}) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [q, setQ] = useState('')
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQ('')
    setCustom('')
    setBusy(true)
    setError(null)
    void api
      .models()
      .then((r) => setModels(r.models ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false))
    requestAnimationFrame(() => input.current?.focus())
  }, [open])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? models.filter((m) => (m.id ?? m.name ?? '').toLowerCase().includes(needle))
      : models
    return list.slice(0, 80)
  }, [models, q])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[76]" onMouseDown={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="absolute w-[340px] overflow-hidden rounded-[14px]"
        style={{
          right: 16,
          bottom: 92,
          background: 'var(--canvas)',
          border: '1px solid var(--line-3)',
          boxShadow: 'var(--shadow-modal)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
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
            <p className="m-0 px-[9px] py-[10px] t-small" style={{ color: 'var(--text-1)' }}>
              {error}
            </p>
          )}
          {!busy && !error && shown.length === 0 && (
            <p className="m-0 px-[9px] py-[10px] t-small" style={{ color: 'var(--text-3)' }}>
              Nothing matches. Type a name below.
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
                {m.context ? (
                  <span className="t-tiny shrink-0" style={{ color: 'var(--text-4)' }}>
                    {Math.round(m.context / 1000)}k
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
            Custom model
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
              placeholder="type the model name…"
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
        </div>
      </motion.div>
    </div>
  )
}
