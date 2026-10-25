import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, type SessionRow, type Settings } from './lib/api'
import { useAgentStream, toHistory } from './lib/stream'
import { newId } from './lib/blocks'
import { Sidebar, type Surface } from './components/Sidebar'
import { Composer, type Mode, type Trust } from './components/Composer'
import { Transcript, EmptyState } from './components/Transcript'
import { StatusBar } from './components/StatusBar'
import { SettingsPanel } from './components/SettingsPanel'
import { CommandPalette } from './components/CommandPalette'
import { DiffPane } from './components/DiffPane'
import { ModeMenu } from './components/ModeMenu'
import { ModelPicker } from './components/ModelPicker'

/* ===========================================================================
   The shell.

   Four regions in a fixed column: a 44px title bar, the sidebar on the left at
   272px, the conversation in the middle, and a 36px floor bar. The composer
   sits at the bottom of the conversation and is centred on the same measure as
   the transcript, so the column reads as one thing.

   Settings come from the server (GET/PUT /api/settings), not from localStorage
   — a preference that does not survive a restart is not a preference.
   =========================================================================== */

const SIDEBAR_KEY = 'loong.sidebar.w'

function persistedWidth(): number {
  try {
    const v = Number(localStorage.getItem(SIDEBAR_KEY))
    return v >= 240 && v <= 400 ? v : 272
  } catch {
    return 272
  }
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  /* Home is a chat; Code is the agent in a folder. The list under each is a
     different list, and that difference is the whole navigation model. */
  const [surface, setSurface] = useState<Surface>('code')
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [diffOpen, setDiffOpen] = useState(false)
  const [modeMenu, setModeMenu] = useState<{ x: number; y: number } | null>(null)
  const [health, setHealth] = useState<boolean | null>(null)
  const [width, setWidth] = useState(persistedWidth)
  const [resizing, setResizing] = useState(false)
  const [runningIds, setRunningIds] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [modelPicker, setModelPicker] = useState(false)
  const dragFrom = useRef<{ x: number; w: number } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const stream = useAgentStream()

  /* Home is a conversation, so it never runs a tool and never needs a folder.
     Code is the agent, and a folder is what makes a session a session. */
  const effectiveMode = surface === 'home' ? 'ask' : (settings?.mode ?? 'agent')

  /* ---- settings ---------------------------------------------------------- */
  useEffect(() => {
    void api
      .getSettings()
      .then((r) => setSettings(r.settings))
      .catch(() => setNotice('the agent is not reachable'))
  }, [])

  const patch = useCallback((p: Partial<Settings>) => {
    setSettings((prev) => (prev ? { ...prev, ...p } : prev))
    void api.putSettings({ settings: p }).catch(() => {})
  }, [])

  /* ---- first run: take a model rather than offering a send that 400s ------ */
  useEffect(() => {
    if (!settings || settings.model) return
    void api
      .models()
      .then((r) => {
        const first = (r.models ?? [])[0] as unknown as { id?: string; name?: string } | undefined
        const chosen = first?.id ?? first?.name
        if (chosen) patch({ model: chosen })
      })
      .catch(() => {})
  }, [settings, patch])

  /* ---- sessions and workspace ------------------------------------------- */
  const reload = useCallback(() => {
    void api.sessions().then((r) => setSessions(r.sessions ?? [])).catch(() => {})
    void api.workspace().then((r) => setWorkspace(r.workspace)).catch(() => {})
  }, [])

  useEffect(reload, [reload])

  useEffect(() => {
    const tick = () => void api.health().then((h) => setHealth(h.ok)).catch(() => setHealth(false))
    tick()
    const t = setInterval(tick, 15000)
    return () => clearInterval(t)
  }, [])

  /* ---- opening a thread -------------------------------------------------- */
  const openThread = useCallback(
    async (id: string) => {
      setActiveId(id)
      try {
        const blocks = await api.loadBlocks(id)
        stream.setBlocks(blocks as never)
        const state = await api.sessionState(id)
        setRunningIds((prev) => (state.running && !prev.includes(id) ? [...prev, id] : prev))
      } catch {
        stream.setBlocks([])
      }
    },
    [stream],
  )

  /* ---- one folder picker ------------------------------------------------- */
  const pickFolder = useCallback(() => {
    const bridge = (window as unknown as { loong?: { pickWorkspace?: () => Promise<string | null> } }).loong
    if (!bridge?.pickWorkspace) {
      setNotice('the folder picker needs the desktop shell')
      return
    }
    void bridge.pickWorkspace().then((picked) => {
      if (picked) void api.setWorkspace(picked).then(() => setWorkspace(picked))
    })
  }, [])

  /* ---- running ----------------------------------------------------------- */
  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || !settings) return
    let id = activeId
    if (!id) {
      const created = await api.createSession(
        surface === 'code' ? (workspace ?? undefined) : undefined,
      ).catch(() => null)
      if (!created) {
        setNotice('could not create a thread')
        return
      }
      id = created.session.id
      setActiveId(id)
      reload()
    }
    setInput('')
    /* the reader's turn goes into the transcript first — it is theirs, and it
       must be visible before the agent answers */
    stream.setBlocks([...stream.blocks, { k: 'user', id: newId(), text, at: Date.now() }])
    setRunningIds((prev) => (id && !prev.includes(id) ? [...prev, id] : prev))

    const threadId = id
    await stream.run({
      threadId,
      sessionId: id,
      messages: [...toHistory(stream.blocks), { role: 'user', content: text }],
      settings: { ...settings, mode: effectiveMode },
    })

    setRunningIds((prev) => prev.filter((x) => x !== threadId))
    void api.saveBlocks(threadId, stream.blocks).catch(() => {})
    void api.renameSession(threadId, text.slice(0, 60)).catch(() => {})
    reload()
  }, [input, settings, activeId, workspace, surface, effectiveMode, stream, reload])

  /* the transcript is persisted whenever it settles, not only on send */
  useEffect(() => {
    if (!activeId || stream.running || stream.blocks.length === 0) return
    const t = setTimeout(() => void api.saveBlocks(activeId, stream.blocks).catch(() => {}), 400)
    return () => clearTimeout(t)
  }, [activeId, stream.running, stream.blocks])

  /* ---- sidebar resize ---------------------------------------------------- */
  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      dragFrom.current = { x: e.clientX, w: width }
      setResizing(true)
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    },
    [width],
  )

  useEffect(() => {
    if (!resizing) return
    const move = (e: PointerEvent) => {
      if (!dragFrom.current) return
      const next = Math.min(400, Math.max(240, dragFrom.current.w + (e.clientX - dragFrom.current.x)))
      setWidth(next)
    }
    const up = () => {
      setResizing(false)
      try {
        localStorage.setItem(SIDEBAR_KEY, String(width))
      } catch {
        /* a private window still works, it just forgets */
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [resizing, width])

  /* Follow the stream, but never yank a reader who has scrolled up to read. */
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (near) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [stream.blocks])

  /* ---- the plan, for the floor bar --------------------------------------- */
  const planCount = useMemo(() => {
    const planBlock = [...stream.blocks].reverse().find((b) => b.k === 'plan')
    if (!planBlock || planBlock.k !== 'plan') return null
    const steps = planBlock.plan.steps ?? []
    if (!steps.length) return null
    return { done: steps.filter((s) => s.status === 'done').length, total: steps.length }
  }, [stream.blocks])

  /* ---- keyboard ---------------------------------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setSidebarOpen((v) => !v)
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        setDiffOpen(true)
      }
      if (e.key === 'Escape' && stream.running) stream.stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stream])

  const folderName = workspace ? (workspace.split(/[\\/]/).filter(Boolean).pop() ?? workspace) : null
  const blockedReason = health === false ? 'agent offline' : !settings?.model ? 'no model' : null


  const composer = settings ? (
    <Composer
      value={input}
      onValueChange={setInput}
      onSend={() => void send()}
      onStop={stream.stop}
      running={stream.running}
      mode={effectiveMode}
      trust={settings.trust}
      folder={folderName}
      showFolder={surface === 'code'}
      onPickFolder={pickFolder}
      model={settings.model}
      onPickModel={() => setModelPicker(true)}
      blockedReason={blockedReason}
      onOpenModeMenu={() => {
        const el = document.querySelector('[aria-label="Permission mode"]')
        const r = el?.getBoundingClientRect()
        setModeMenu(r ? { x: r.left, y: r.top } : { x: 200, y: window.innerHeight - 120 })
      }}
    />
  ) : null


  return (
    <div className="flex h-full w-full flex-col" style={{ background: 'var(--canvas)' }}>
      {/* ---- the title bar 44px ------------------------------------------- */}
      <header
        className="flex h-[38px] shrink-0 items-center gap-[10px] px-[12px]"
        style={{ borderBottom: '1px solid var(--line-1)', background: 'var(--canvas)' }}
      >
        <button
          type="button"
          className="ctl grid h-[24px] w-[24px] place-items-center rounded-[6px]"
          aria-label={sidebarOpen ? 'Hide the sidebar' : 'Show the sidebar'}
          title={sidebarOpen ? 'Hide the sidebar — Ctrl B' : 'Show the sidebar — Ctrl B'}
          onClick={() => setSidebarOpen((v) => !v)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6.5 3v10" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>

        <span className="mono min-w-0 truncate t-caption" style={{ color: 'var(--text-2)' }}>
          {folderName ?? (surface === 'code' ? 'no folder' : 'chat')}
        </span>

        {activeId && (
          <>
            <span className="t-tiny" style={{ color: 'var(--text-4)' }}>
              /
            </span>
            <span className="min-w-0 truncate t-caption" style={{ color: 'var(--text-3)' }}>
              {sessions.find((x) => x.id === activeId)?.title ?? ''}
            </span>
          </>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          sessions={sessions}
          activeId={activeId}
          runningIds={runningIds}
          surface={surface}
          open={sidebarOpen}
          width={width}
          onToggle={() => setSidebarOpen((v) => !v)}
          onSurface={(next) => {
            setSurface(next)
            setActiveId(null)
            stream.setBlocks([])
          }}
          onOpenThread={(id) => void openThread(id)}
          onNewThread={() => {
            setActiveId(null)
            stream.setBlocks([])
          }}
          onRename={(id, title) => void api.renameSession(id, title).then(reload)}
          onDelete={(id) => setDeleteTarget(id)}
          onOpenSettings={() => setSettingsOpen(true)}
          onSearch={() => setPaletteOpen(true)}
          onResizeStart={onResizeStart}
          onResizeReset={() => setWidth(272)}
          resizing={resizing}
        />

        <main className="relative flex min-w-0 flex-1 flex-col">
          <AnimatePresence>
            {notice && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="px-[24px] pt-[10px]"
              >
                <p className="m-0 t-small" style={{ color: 'var(--text-2)' }}>
                  {notice}{' '}
                  <button
                    type="button"
                    className="ctl rounded-[5px] px-[6px] py-[1px] t-tiny"
                    style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
                    onClick={() => setNotice(null)}
                  >
                    dismiss
                  </button>
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {stream.error && (
            <div className="px-[24px] pt-[12px]">
              <p className="m-0 t-small" style={{ color: 'var(--text-1)' }}>
                {stream.error}
              </p>
              <button
                type="button"
                className="ctl mt-[6px] rounded-[8px] px-[12px] py-[5px] t-small"
                style={{ border: '1px solid var(--line-3)', color: 'var(--text-1)' }}
                onClick={() => {
                  stream.clearError()
                  void send()
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* ONE composer, ONE place in the tree. Centred with the creature when
              the thread is empty, anchored to the floor when it is not — by CSS,
              never by a different JSX branch, because a branch remounts the
              field and remounting is what loses an IME composition. */}
          <div
            className={
              stream.blocks.length === 0
                ? 'flex min-h-0 flex-1 flex-col items-center justify-center gap-[26px] px-[24px] pb-[5vh]'
                : 'flex min-h-0 flex-1 flex-col'
            }
          >
            {stream.blocks.length === 0 ? (
              <EmptyState running={stream.running} />
            ) : (
              <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
                <Transcript
                  bare
                  blocks={stream.blocks}
                  view={settings?.view ?? 'normal'}
                  running={stream.running}
                  onDecide={(id, approved) => void api.decide(id, approved).catch(() => {})}
                  onAnswer={(id, answer) => void api.answer(id, answer).catch(() => {})}
                  onRetry={() => void send()}
                />
              </div>
            )}

            <div className={stream.blocks.length === 0 ? 'w-full' : 'shrink-0 pb-[18px] pt-[10px]'}>
              {composer}
            </div>
          </div>
        </main>
      </div>

      <StatusBar
        running={stream.running}
        phase={stream.phase}
        mode={settings?.mode ?? 'agent'}
        model={stream.usage?.model ?? settings?.model ?? ''}
        plan={planCount}
        workspace={workspace}
        usage={stream.usage}
        health={health}
      />

      <ModeMenu
        open={modeMenu !== null}
        anchor={modeMenu}
        onClose={() => setModeMenu(null)}
        mode={(settings?.mode ?? 'agent') as Mode}
        trust={(settings?.trust ?? 'ask') as Trust}
        onPick={(m, t) => patch({ mode: m, trust: t })}
      />

      <ModelPicker
        open={modelPicker}
        current={settings?.model ?? ''}
        provider={settings?.provider ?? 'ollama'}
        onClose={() => setModelPicker(false)}
        onPick={(model) => patch({ model })}
        onProvider={(provider) => {
          /* a provider change invalidates the model: pick the first one the new
             provider offers rather than leaving a name it cannot run */
          patch({ provider })
          void api
            .models()
            .then((r) => {
              const first = (r.models ?? [])[0] as unknown as { id?: string; name?: string } | undefined
              const chosen = first?.id ?? first?.name
              if (chosen) patch({ model: chosen })
            })
            .catch(() => {})
        }}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        sessions={sessions}
        activeId={activeId}
        onOpenThread={(id) => void openThread(id)}
        onNewThread={() => {
          setActiveId(null)
          stream.setBlocks([])
        }}
        onPickFolder={pickFolder}
      />

      {diffOpen && <DiffPane onClose={() => setDiffOpen(false)} />}

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings ?? DEFAULT}
        onChange={patch}
        health={health}
      />

      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 z-[80] grid place-items-center"
            style={{ background: 'var(--scrim)' }}
            onMouseDown={() => setDeleteTarget(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.99 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="w-[430px] rounded-[16px] p-[20px]"
              style={{ background: 'var(--canvas)', border: '1px solid var(--line-3)', boxShadow: 'var(--shadow-modal)' }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h2 className="display m-0 t-h3">Delete this thread?</h2>
              <p className="mt-[6px] mb-[18px] t-small leading-[1.6]" style={{ color: 'var(--text-3)' }}>
                The conversation goes for good — it cannot be undone. Files the agent already wrote
                stay where they are.
              </p>
              <div className="flex items-center justify-end gap-[8px]">
                <button
                  type="button"
                  className="ctl rounded-[8px] px-[12px] py-[6px] t-small"
                  style={{ border: '1px solid var(--line-2)', color: 'var(--text-1)' }}
                  onClick={() => setDeleteTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ctl rounded-[8px] px-[14px] py-[6px] t-small"
                  style={{ background: 'var(--btn-primary)', color: 'var(--btn-primary-text)' }}
                  onClick={() => {
                    const id = deleteTarget
                    setDeleteTarget(null)
                    void api.deleteSession(id).then(() => {
                      if (activeId === id) {
                        setActiveId(null)
                        stream.setBlocks([])
                      }
                      reload()
                    })
                  }}
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const DEFAULT: Settings = {
  provider: 'ollama',
  model: '',
  route: 'auto',
  mode: 'agent',
  trust: 'ask',
  soundEnabled: false,
  volume: 0.4,
  reducedMotion: false,
  fontSize: 14,
  view: 'normal',
  userName: '',
}
