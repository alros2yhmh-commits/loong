import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { PROVIDERS, useSettings, type ProviderId, type SavedCommand } from '../lib/settings'
import { isWeakModel } from '../lib/router'
import type { Health, LocalModel, RemoteModel } from '../lib/api'
import { api } from '../lib/api'
import { keyHas, keySet as storeKey, secureKeys } from '../lib/keys'
import { sound } from '../lib/sound'
import { dur, easeOut, spring } from '../motion/tokens'
import { IconChevron } from './Icons'
import { McpPanel } from './McpPanel'
import { AnalyticsPanel } from './AnalyticsPanel'

/* ---------------------------------------------------------------------------
   Settings.

   A full surface, not a dropdown — the provider block alone needs a key field,
   a model field, an endpoint and an explanation, and hiding that inside a
   popover would make the most important screen in the app the smallest one.
   --------------------------------------------------------------------------- */

interface SettingsProps {
  open: boolean
  onClose: () => void
  health: Health | null
  models: LocalModel[]
  /** the live OpenRouter catalogue, already filtered to tool-capable models */
  remoteModels: RemoteModel[]
}

export function Settings({
  open,
  onClose,
  health,
  models,
  remoteModels,
}: SettingsProps) {
  const { settings, set, provider, reset } = useSettings()
  const localModels = models.filter((m) => m.name)
  /* the key never comes back from wherever it lives — only whether it exists */
  const [keyDraft, setKeyDraft] = useState('')
  const [keyExists, setKeyExists] = useState(false)
  /* what the agent kept between sessions — shown so it can be inspected and
     deleted; memory you cannot see is memory you cannot trust */
  const [memory, setMemory] = useState<
    { id: string; text: string; workspace: string | null; at: number }[]
  >([])
  /* a search box over the (long) OpenRouter catalogue so a model can be found
     without scrolling a hundred-row dropdown */
  const [modelQuery, setModelQuery] = useState('')
  /* the open catalog: pick a provider, and its models appear — with what they
     can do (images, tools, reasoning) and what they cost. No typing. */
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof api.catalogModels>>['models']>([])
  const [catalogError, setCatalogError] = useState<string | null>(null)
  useEffect(() => {
    if (settings.provider === 'ollama' || settings.provider === 'custom') return
    let alive = true
    setCatalog([])
    setCatalogError(null)
    void api
      .catalogModels(settings.provider)
      .then((r) => {
        if (!alive) return
        setCatalog(r.models ?? [])
        setCatalogError(r.error ?? null)
      })
      .catch(() => {
        if (alive) setCatalogError('the catalog could not be reached')
      })
    return () => {
      alive = false
    }
  }, [settings.provider])

  useEffect(() => {
    if (!open) return
    void api
      .memory()
      .then((r) => setMemory(r.entries ?? []))
      .catch(() => setMemory([]))
  }, [open])

  useEffect(() => {
    let alive = true
    void keyHas(provider.id).then((has) => {
      if (alive) setKeyExists(has)
    })
    return () => {
      alive = false
    }
  }, [provider.id])

  const saveKey = async () => {
    const key = keyDraft.trim()
    if (!key) return
    const ok = await storeKey(provider.id, key)
    if (ok) {
      setKeyDraft('')
      setKeyExists(true)
      sound.play('approve')
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-[70] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur.enter, ease: easeOut }}
          style={{ background: 'var(--scrim)' }}
          onMouseDown={onClose}
        >
          <motion.div
            className="flex max-h-[82vh] w-[620px] flex-col overflow-hidden rounded-[14px]"
            style={{
              background: 'var(--canvas)',
              border: '1px solid var(--line-4)',
            }}
            initial={{ opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.995 }}
            transition={spring.drawer}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between px-[18px] py-[13px]">
              <h2 className="display m-0 text-[14px]">Settings</h2>
              <button
                type="button"
                className="ctl rounded-[6px] px-[9px] py-[4px] text-[11.5px]"
                style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
                onClick={onClose}
              >
                Close
              </button>
            </header>

            <div className="rule-engraved" />

            {/* one row of jumps — eleven sections in a scroll is a maze, and a
                person who came for the model should not pass the sounds to
                reach it */}
            <nav
              className="flex flex-wrap items-center gap-[4px] px-[18px] py-[8px]"
              style={{ borderBottom: '1px solid var(--line-1)' }}
            >
              {[
                ['runtime', 'Runtime'],
                ['provider', 'Model'],
                ['memory', 'Memory'],
                ['autonomy', 'Autonomy'],
                ['mcp', 'MCP'],
                ['appearance', 'Look'],
                ['sound', 'Sound'],
                ['motion', 'Motion'],
                ['layout', 'Layout'],
                ['commands', 'Commands'],
                ['analytics', 'Analytics'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="ctl mono rounded-[5px] px-[7px] py-[3px] text-[10.5px]"
                  style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
                  onClick={() => {
                    document.getElementById(id)?.scrollIntoView({ block: 'start' })
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <Section
                id="runtime"
                title="Runtime"
                note="The agent is a separate local process. It is the only thing that ever sees an API key."
              >
                <Row label="Agent">
                  <span
                    className="mono text-[11.5px]"
                    style={{ color: health ? 'var(--text-2)' : 'var(--text-4)' }}
                  >
                    {health
                      ? `online · ${health.workspace}`
                      : 'offline — run npm run server'}
                  </span>
                </Row>
                <Row label="Called">
                  <input
                    value={settings.userName}
                    onChange={(e) => set('userName', e.target.value.slice(0, 40))}
                    placeholder="your name — optional"
                    className="w-full bg-transparent text-[11.5px] outline-none"
                    style={{ color: 'var(--text-1)' }}
                  />
                </Row>
                {settings.provider === 'ollama' && (
                  <Row label="Ollama">
                    <span
                      className="mono text-[11.5px]"
                      style={{
                        color: health?.ollama.up ? 'var(--text-2)' : 'var(--text-4)',
                      }}
                    >
                      {health?.ollama.up
                        ? `running · v${health.ollama.version ?? '?'}`
                        : 'not running'}
                    </span>
                  </Row>
                )}
              </Section>

              <Section
                id="provider"
                title="Provider"
                note="Where the model comes from. Keys are sent to the local agent process and are never held by the interface."
              >
                <div className="flex flex-wrap gap-[5px]">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="ctl rounded-[6px] px-[10px] py-[5px] text-[12px]"
                      style={{
                        color:
                          settings.provider === p.id
                            ? 'var(--text-1)'
                            : 'var(--text-3)',
                        border: `1px solid ${
                          settings.provider === p.id
                            ? 'var(--line-4)'
                            : 'var(--line-1)'
                        }`,
                        background:
                          settings.provider === p.id
                            ? 'var(--surface)'
                            : 'transparent',
                      }}
                      onClick={() => {
                        sound.play('select')
                        set('provider', p.id as ProviderId)
                        if (p.suggestions[0]) set('model', p.suggestions[0])
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <p
                  className="mt-[9px] text-[11.5px] leading-[1.6]"
                  style={{ color: 'var(--text-4)' }}
                >
                  {provider.blurb}
                </p>

                <Row label="Model">
                  {settings.provider === 'ollama' && localModels.length > 0 ? (
                    <select
                      value={settings.model}
                      onChange={(e) => {
                        set('model', e.target.value)
                        /* a model picked here must actually be used — the router
                           otherwise overrides it, which is what made the picker
                           feel like it "did nothing" */
                        set('route', 'manual')
                      }}
                      className="mono w-full bg-transparent text-[11.5px] outline-none"
                      style={{ color: 'var(--text-1)' }}
                    >
                      <option value="">choose a model…</option>
                      {localModels.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name}
                          {m.supportsTools ? '' : '  — no tool support'}
                        </option>
                      ))}
                    </select>
                  ) : settings.provider !== 'ollama' && catalog.length > 0 ? (
                    /* any provider, discovered — the same list the router reads */
                    <div className="flex w-full flex-col gap-[6px]">
                      <div className="flex items-center gap-[8px]">
                        <input
                          value={modelQuery}
                          onChange={(e) => setModelQuery(e.target.value)}
                          placeholder="filter models…"
                          className="mono min-w-0 flex-1 bg-transparent text-[11.5px] outline-none"
                          style={{ color: 'var(--text-1)' }}
                        />
                        <span className="mono shrink-0 text-[10px]" style={{ color: 'var(--text-4)' }}>
                          {catalog.length} models
                        </span>
                      </div>
                      <div
                        className="max-h-[220px] w-full overflow-y-auto rounded-[6px]"
                        style={{ border: '1px solid var(--line-2)' }}
                      >
                        {catalog
                          .filter((m) => m.id.toLowerCase().includes(modelQuery.toLowerCase().trim()))
                          .map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => {
                                set('model', m.id)
                                set('route', 'manual')
                              }}
                              className="mono flex w-full items-center gap-[7px] px-[9px] py-[5px] text-left text-[11.5px]"
                              style={{
                                background: settings.model === m.id ? 'var(--surface)' : 'transparent',
                                color: settings.model === m.id ? 'var(--text-1)' : 'var(--text-3)',
                              }}
                            >
                              <span className="min-w-0 flex-1 truncate" title={m.name}>{m.id}</span>
                              {m.vision && (
                                <span title="reads images" style={{ color: 'var(--text-4)' }}>img</span>
                              )}
                              {m.reasoning && (
                                <span title="reasoning — stronger, slower" style={{ color: 'var(--text-4)' }}>think</span>
                              )}
                              {m.context && (
                                <span style={{ color: 'var(--text-4)' }}>{Math.round(m.context / 1000)}k</span>
                              )}
                            </button>
                          ))}
                      </div>
                      {catalogError && (
                        <p className="m-0 text-[11px]" style={{ color: 'var(--text-4)' }}>
                          {catalogError} — type the model id below instead.
                        </p>
                      )}
                    </div>
                  ) : settings.provider === 'openrouter' && remoteModels.length > 0 ? (
                    <>
                      <div className="flex w-full flex-col gap-[6px]">
                        <div className="flex items-center gap-[8px]">
                          <input
                            value={modelQuery}
                            onChange={(e) => setModelQuery(e.target.value)}
                            placeholder="filter models…"
                            className="mono min-w-0 flex-1 bg-transparent text-[11.5px] outline-none"
                            style={{ color: 'var(--text-1)' }}
                          />
                          <span className="mono shrink-0 text-[10px]" style={{ color: 'var(--text-4)' }}>
                            {remoteModels.filter((m) => m.free).length} free
                          </span>
                        </div>
                        <div
                          className="max-h-[220px] w-full overflow-y-auto rounded-[6px]"
                          style={{ border: '1px solid var(--line-2)' }}
                        >
                          {remoteModels
                            .filter((m) => m.id.toLowerCase().includes(modelQuery.toLowerCase().trim()))
                            .map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => {
                                  set('model', m.id)
                                  set('route', 'manual')
                                }}
                                className="mono flex w-full items-center gap-[8px] px-[9px] py-[5px] text-left text-[11.5px]"
                                style={{
                                  background: settings.model === m.id ? 'var(--surface)' : 'transparent',
                                  color: settings.model === m.id ? 'var(--text-1)' : 'var(--text-3)',
                                }}
                              >
                                <span className="min-w-0 flex-1 truncate">{m.id}</span>
                                <span style={{ color: 'var(--text-4)' }}>
                                  {Math.round(m.contextLength / 1000)}k
                                </span>
                                {m.free && <span style={{ color: 'var(--text-4)' }}>free</span>}
                                {isWeakModel(m.id, m.contextLength) && (
                                  <span style={{ color: 'var(--text-4)' }} title="Too small to drive the agent reliably — ask mode only">
                                    weak
                                  </span>
                                )}
                              </button>
                            ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <input
                        list="loong-models"
                        value={settings.model}
                        onChange={(e) => {
                          set('model', e.target.value)
                          set('route', 'manual')
                        }}
                        className="w-full bg-transparent text-[12.5px] outline-none"
                        style={{ color: 'var(--text-1)' }}
                        placeholder="model id"
                      />
                      <datalist id="loong-models">
                        {provider.suggestions.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    </>
                  )}
                </Row>

                {/* the OpenRouter free tier shares one small quota across every
                    user, so an overloaded upstream is the normal case rather
                    than a fault. Saying so up front stops it looking like Loong
                    is broken. */}
                {settings.provider === 'openrouter' && (
                  <p
                    className="mt-[6px] mb-0 text-[11.5px] leading-[1.6]"
                    style={{ color: 'var(--text-4)' }}
                  >
                    Free models are shared and frequently overloaded. Loong retries
                    three times with a backoff and tells you what happened; if it
                    keeps failing, switch to another model — the list above is live
                    from OpenRouter and only shows models that can call tools.
                  </p>
                )}

                {/* the one warning worth surfacing here: a model whose chat
                    template has no tool tokens will answer in prose instead of
                    calling anything, and that looks like a bug in the app */}
                {settings.provider === 'ollama' &&
                  localModels.some(
                    (m) => m.name === settings.model && !m.supportsTools,
                  ) && (
                    <p
                      className="mt-[6px] mb-0 text-[11.5px] leading-[1.6]"
                      style={{ color: 'var(--text-3)' }}
                    >
                      This model&apos;s chat template has no tool tokens, so it emits
                      tool calls as text and nothing will run. Pick a model without
                      &quot;coder&quot; in the name, or add a cloud key below.
                    </p>
                  )}

                {/* the router: which model answers each message. Every leading
                    agent routes in 2026; the floor here is a rule, not a hope —
                    a model that cannot call tools is never routed to, because
                    the failure is silent (the agent just stops). */}
                <Row label="Router">
                  <div className="flex flex-wrap gap-[4px]">
                    {(['manual', 'auto', 'fast', 'deep'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        className="ctl rounded-[5px] px-[8px] py-[2px] text-[10.5px]"
                        style={{
                          color: settings.route === r ? 'var(--text-1)' : 'var(--text-4)',
                          border: `1px solid ${settings.route === r ? 'var(--line-3)' : 'transparent'}`,
                          background: settings.route === r ? 'var(--surface)' : 'transparent',
                        }}
                        onClick={() => set('route', r)}
                        title={
                          r === 'manual'
                            ? 'Manual — always the model chosen above.'
                            : r === 'auto'
                              ? 'Auto — reads the message: big refactors and "why" questions go deep, everything else goes fast. Only models that can call tools are ever chosen.'
                              : r === 'fast'
                                ? 'Fast — the quickest tool-capable model: a local one when there is one, otherwise the free tier.'
                                : 'Deep — the strongest tool-capable model: paid and wide-context first.'
                        }
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </Row>
                {settings.route !== 'manual' && (
                  <p
                    className="mt-[6px] mb-0 text-[11px] leading-[1.6]"
                    style={{ color: 'var(--text-4)' }}
                  >
                    {settings.route === 'auto'
                      ? 'Auto picks per message — a local model when one can call tools, otherwise the free tier for quick asks and the strongest tool-capable model for the hard ones.'
                      : settings.route === 'fast'
                        ? 'Fast always picks the quickest tool-capable model.'
                        : 'Deep always picks the strongest tool-capable model.'}
                  </p>
                )}

                <Row label="Endpoint">
                  <input
                    value={
                      provider.endpoint === null
                        ? settings.baseUrl
                        : provider.endpoint
                    }
                    readOnly={provider.endpoint !== null}
                    onChange={(e) => set('baseUrl', e.target.value)}                    className="mono w-full bg-transparent text-[11.5px] outline-none"
                    style={{
                      color:
                        provider.endpoint !== null
                          ? 'var(--text-4)'
                          : 'var(--text-1)',
                    }}
                    placeholder="https://…"
                  />
                </Row>

                {provider.keyed && (
                  <Row label="API key">
                    <input
                      type="password"
                      value={keyDraft}
                      onChange={(e) => setKeyDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void saveKey()
                        }
                      }}
                      className="mono w-full bg-transparent text-[11.5px] outline-none"
                      style={{ color: 'var(--text-1)' }}
                      placeholder={keyExists ? '•••••••• (stored — type to replace)' : 'sk-…'}
                    />
                    <button
                      type="button"
                      className="ctl mono shrink-0 rounded-[5px] px-[7px] py-[2px] text-[10px]"
                      style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
                      onClick={() => void saveKey()}
                    >
                      {keyExists ? 'replace' : 'save'}
                    </button>
                    <span
                      className="mono shrink-0 text-[10px]"
                      style={{ color: keyExists ? 'var(--text-3)' : 'var(--text-4)' }}
                    >
                      {keyExists
                        ? secureKeys()
                          ? 'in the OS keychain'
                          : 'stored locally'
                        : 'required'}
                    </span>
                  </Row>
                )}
              </Section>

              <Section
                id="appearance"
                title="Appearance"
                note="One warm monochrome ramp — Claude Desktop's grade with Loong's engraving. One look, no accent colour to configure."
              >
                <Row label="Thread text">
                  <Slider
                    value={settings.threadFontSize}
                    min={12}
                    max={17}
                    step={0.5}
                    onChange={(v) => set('threadFontSize', v)}
                    readout={`${settings.threadFontSize}px`}
                  />
                </Row>
              </Section>

              <Section
                id="sound"
                title="Sound"
                note="Generated from parameters at runtime, so there is no audio file to find. Off by default, and deliberately quiet when on."
              >
                <Row label="Enabled">
                  <div className="flex gap-[5px]">
                    <Chip
                      active={settings.soundEnabled}
                      onClick={() => {
                        set('soundEnabled', true)
                        sound.setEnabled(true)
                        sound.play('select')
                      }}
                    >
                      On
                    </Chip>
                    <Chip
                      active={!settings.soundEnabled}
                      onClick={() => {
                        set('soundEnabled', false)
                        sound.setEnabled(false)
                      }}
                    >
                      Off
                    </Chip>
                  </div>
                </Row>
                <Row label="Volume">
                  <Slider
                    value={settings.volume}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(v) => {
                      set('volume', v)
                      sound.setVolume(v)
                    }}
                    readout={`${Math.round(settings.volume * 100)}%`}
                  />
                </Row>
              </Section>

              <Section
                id="motion"
                title="Motion"
                note="System follows the operating system. Reduced stills every animation in the app, including the springs."
              >
                <Row label="Level">
                  <div className="flex gap-[5px]">
                    {(['system', 'full', 'reduced'] as const).map((m) => (
                      <Chip
                        key={m}
                        active={settings.motion === m}
                        onClick={() => set('motion', m)}
                      >
                        {m === 'system'
                          ? 'System'
                          : m === 'full'
                            ? 'Full'
                            : 'Reduced'}
                      </Chip>
                    ))}
                  </div>
                </Row>
              </Section>

              <Section
                id="commands"
                title="Commands"
                note="Saved prompts you invoke as /name args in the composer. $ARGUMENTS is replaced with whatever follows the name. They are prompts, not code — edit, add and delete freely."
              >
                <CommandsPanel />
              </Section>

              <Section
                id="autonomy"
                title="Autonomy"
                note="Confidence-gated writes for full-trust mode, borrowed from TypeSafe's Jev: run a write only when the decision model is sure enough; below the threshold it parks for you instead."
              >
                <AutonomyPanel />
              </Section>

              <Section
                id="analytics"
                title="Analytics"
                note="What the runs actually cost — time, tokens, outcomes and the slowest tools. Read from the local traces; nothing leaves this machine."
              >
                <AnalyticsPanel />
              </Section>

              <Section
                id="layout"
                title="Layout"
                note="Rail, thread column and the saved-threads drawer are all draggable. Drag their edges, double-click an edge to reset it."
              >
                <Row label="Reset">
                  <button
                    type="button"
                    className="ctl rounded-[6px] px-[10px] py-[4px] text-[11.5px]"
                    style={{
                      border: '1px solid var(--line-2)',
                      color: 'var(--text-2)',
                    }}
                    onClick={() => {
                      sound.play('click')
                      reset()
                    }}
                  >
                    Restore defaults
                  </button>
                </Row>
              </Section>

              <Section
                id="mcp"
                title="MCP servers"
                note="Other systems the agent can reach — a browser's DevTools, a database, a tracker. Their tools join every run, and every non-read-only call still asks first."
              >
                <McpPanel />
              </Section>

              <Section
                id="memory"
                title="Memory"
                note="Facts the agent kept across sessions — this project first, then the ones that are true everywhere. Delete one and it is gone for good."
              >
                {memory.length === 0 ? (
                  <p className="m-0 px-[2px] py-[6px] text-[12px]" style={{ color: 'var(--text-4)' }}>
                    Nothing saved yet. The agent writes here when you tell it to remember something.
                  </p>
                ) : (
                  (() => {
                    const projectName = (ws: string | null) =>
                      ws ? ws.split(/[\\/]/).filter(Boolean).pop() ?? ws : null
                    const ago = (at: number) => {
                      const d = Math.round((Date.now() - at) / 86_400_000)
                      if (d <= 0) return 'today'
                      if (d === 1) return 'yesterday'
                      if (d < 30) return `${d} days ago`
                      return new Date(at).toLocaleDateString()
                    }
                    const mine = memory.filter((m) => m.workspace !== null)
                    const world = memory.filter((m) => m.workspace === null)
                    const group = (label: string, rows: typeof memory) =>
                      rows.length === 0 ? null : (
                        <div className="flex flex-col gap-[6px]">
                          <p
                            className="mono m-0 text-[9.5px] tracking-[0.1em] uppercase"
                            style={{ color: 'var(--text-4)' }}
                          >
                            {label} · {rows.length}
                          </p>
                          {rows.map((m) => (
                            <div
                              key={m.id}
                              className="group flex items-start gap-[10px] rounded-[7px] px-[9px] py-[7px]"
                              style={{ border: '1px solid var(--line-2)', background: 'var(--surface-sunken)' }}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="m-0 text-[12.5px] leading-[1.5]" style={{ color: 'var(--text-1)' }}>
                                  {m.text}
                                </p>
                                <p className="mono m-0 mt-[3px] text-[9.5px]" style={{ color: 'var(--text-4)' }}>
                                  {m.workspace === null ? 'everywhere' : `project · ${projectName(m.workspace)}`} · {ago(m.at)}
                                </p>
                              </div>
                              <button
                                type="button"
                                className="ctl shrink-0 rounded-[5px] px-[7px] py-[3px] text-[10.5px] opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus:opacity-100"
                                style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
                                title="Delete this fact"
                                onClick={() => {
                                  void api
                                    .forgetMemory(m.id)
                                    .then(() => setMemory((prev) => prev.filter((x) => x.id !== m.id)))
                                }}
                              >
                                forget
                              </button>
                            </div>
                          ))}
                        </div>
                      )
                    return (
                      <div className="flex flex-col gap-[14px]">
                        {group('This project', mine)}
                        {group('Everywhere', world)}
                      </div>
                    )
                  })()
                )}
              </Section>
            </div>

            <div className="rule-engraved" />
            <footer className="px-[18px] py-[10px]">
              <p className="mono m-0 text-[10.5px]" style={{ color: 'var(--text-4)' }}>
                Loong (龙) 0.1.0 · built by Professor Hamza Mahmoud Ramadan
              </p>
              <p className="mono m-0 mt-[2px] text-[10px]" style={{ color: 'var(--text-5)' }}>
                agent {health ? 'connected' : 'not running'} · the key stays in this process, never in the browser
              </p>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function CommandsPanel() {
  const { settings, set } = useSettings()
  const [editing, setEditing] = useState<SavedCommand | 'new' | null>(null)
  const cmds = settings.commands

  const upsert = (c: SavedCommand) => {
    if (cmds.some((x) => x.name === c.name && x.id !== c.id)) return
    set(
      'commands',
      cmds.some((x) => x.id === c.id)
        ? cmds.map((x) => (x.id === c.id ? c : x))
        : [...cmds, c],
    )
    sound.play('approve')
    setEditing(null)
  }
  const remove = (id: string) => {
    sound.play('select')
    set('commands', cmds.filter((c) => c.id !== id))
  }

  return (
    <div className="flex flex-col gap-[9px]">
      {cmds.length === 0 && (
        <p className="m-0 text-[11.5px]" style={{ color: 'var(--text-4)' }}>
          No saved commands yet. Add one, then type /name in the composer.
        </p>
      )}
      {cmds.map((c) => (
        <div key={c.id} className="flex items-start gap-[9px]">
          <div className="min-w-0 flex-1">
            <p className="mono m-0 text-[12px]" style={{ color: 'var(--text-1)' }}>
              /{c.name}
            </p>
            <p className="m-0 mt-[2px] text-[11.5px] leading-[1.5]" style={{ color: 'var(--text-3)' }}>
              {c.prompt}
            </p>
          </div>
          <button
            type="button"
            className="ctl shrink-0 rounded-[5px] px-[7px] py-[2px] text-[10.5px]"
            style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
            onClick={() => setEditing(c)}
          >
            edit
          </button>
          <button
            type="button"
            className="ctl shrink-0 rounded-[5px] px-[7px] py-[2px] text-[10.5px]"
            style={{ border: '1px solid var(--line-2)', color: 'var(--text-4)' }}
            onClick={() => remove(c.id)}
          >
            delete
          </button>
        </div>
      ))}
      {editing && (
        <CommandEditor
          value={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={upsert}
        />
      )}
      {!editing && (
        <button
          type="button"
          className="ctl self-start rounded-[6px] px-[10px] py-[5px] text-[11.5px]"
          style={{ border: '1px solid var(--line-2)', color: 'var(--text-2)' }}
          onClick={() => setEditing('new')}
        >
          + new command
        </button>
      )}
    </div>
  )
}

function CommandEditor({
  value,
  onCancel,
  onSave,
}: {
  value: SavedCommand | null
  onCancel: () => void
  onSave: (c: SavedCommand) => void
}) {
  const [name, setName] = useState(value?.name ?? '')
  const [prompt, setPrompt] = useState(value?.prompt ?? '')
  const id = value?.id ?? `cmd-${Date.now().toString(36)}`
  const nameOk = /^[a-z0-9][a-z0-9-]*$/.test(name)
  const ok = nameOk && prompt.trim().length > 0
  return (
    <div
      className="flex flex-col gap-[8px] rounded-[8px] px-[10px] py-[10px]"
      style={{ border: '1px solid var(--line-2)', background: 'var(--surface-sunken)' }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="name — a-z, 0-9 and dashes"
        className="mono w-full bg-transparent text-[12px] outline-none"
        style={{ color: 'var(--text-1)' }}
      />
      {name && !nameOk && (
        <p className="m-0 text-[10.5px]" style={{ color: 'var(--text-4)' }}>
          lowercase letters, numbers and dashes only
        </p>
      )}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        placeholder="the prompt — use $ARGUMENTS where the arguments go"
        className="w-full resize-none bg-transparent text-[12px] leading-[1.5] outline-none"
        style={{ color: 'var(--text-1)' }}
      />
      <div className="flex items-center gap-[7px]">
        <button
          type="button"
          disabled={!ok}
          className="rounded-[6px] px-[12px] py-[5px] text-[11.5px]"
          style={{
            background: 'var(--text-1)',
            color: 'var(--canvas)',
            opacity: ok ? 1 : 0.4,
            fontWeight: 500,
          }}
          onClick={() => onSave({ id, name, prompt })}
        >
          save
        </button>
        <button
          type="button"
          className="ctl rounded-[6px] px-[12px] py-[5px] text-[11.5px]"
          style={{ border: '1px solid var(--line-3)', color: 'var(--text-2)' }}
          onClick={onCancel}
        >
          cancel
        </button>
      </div>
    </div>
  )
}

function AutonomyPanel() {
  const { settings, set } = useSettings()
  return (
    <div className="flex flex-col gap-[4px]">
      <Row label="Confidence gate">
        <Slider
          value={settings.confidenceThreshold}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => set('confidenceThreshold', v)}
          readout={settings.confidenceThreshold.toFixed(2)}
        />
      </Row>
      <Row label="Decision model">
        <input
          value={settings.decisionModel}
          onChange={(e) => set('decisionModel', e.target.value)}
          placeholder="blank = the run's own model"
          className="mono w-full bg-transparent text-[11.5px] outline-none"
          style={{ color: 'var(--text-1)' }}
        />
      </Row>
      <p className="m-0 mt-[6px] text-[11px] leading-[1.62]" style={{ color: 'var(--text-4)' }}>
        In Full-trust mode a gated write runs only when the decision model&apos;s confidence
        clears this gate; below it, the run parks the change for you instead. If the
        decision call fails it always parks — it never guesses. This is the model&apos;s own
        estimate, not a calibrated probability; point the decision model at a cheap typed
        one (TypeSafe&apos;s jev-router on OpenRouter) to make the check fast and cheap.
      </p>
    </div>
  )
}

function Section({
  id,
  title,
  note,
  children,
}: {
  id?: string
  title: string
  note: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <section id={id} style={{ borderBottom: '1px solid var(--line-1)', scrollMarginTop: 8 }}>
      <button
        type="button"
        className="flex w-full items-center gap-[8px] px-[18px] pt-[14px] pb-[6px] text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: dur.hover, ease: easeOut }}
          style={{ color: 'var(--text-4)', display: 'grid', placeItems: 'center' }}
        >
          <IconChevron size={12} />
        </motion.span>
        <span className="text-[12.5px]" style={{ color: 'var(--text-1)' }}>
          {title}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: dur.panel, ease: easeOut }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-[18px] pb-[16px]">
              <p
                className="mb-[12px] text-[11.5px] leading-[1.62]"
                style={{ color: 'var(--text-4)' }}
              >
                {note}
              </p>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div
      className="flex items-center gap-[14px] py-[7px]"
      style={{ borderTop: '1px solid var(--line-1)' }}
    >
      <span
        className="w-[104px] shrink-0 text-[12px]"
        style={{ color: 'var(--text-3)' }}
      >
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-[9px]">{children}</div>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className="ctl rounded-[5px] px-[9px] py-[3px] text-[11.5px]"
      style={{
        color: active ? 'var(--text-1)' : 'var(--text-4)',
        border: `1px solid ${active ? 'var(--line-3)' : 'transparent'}`,
        background: active ? 'var(--surface)' : 'transparent',
      }}
      onClick={() => {
        sound.play('select')
        onClick()
      }}
    >
      {children}
    </button>
  )
}

function Slider({
  value,
  min,
  max,
  step,
  onChange,
  readout,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  readout: string
}) {
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-[3px] flex-1 cursor-pointer appearance-none rounded-full"
        style={{
          background: `linear-gradient(to right, var(--line-5) ${
            ((value - min) / (max - min)) * 100
          }%, var(--line-2) ${((value - min) / (max - min)) * 100}%)`,
        }}
      />
      <span
        className="mono w-[44px] shrink-0 text-right text-[11px]"
        style={{ color: 'var(--text-3)' }}
      >
        {readout}
      </span>
    </>
  )
}
