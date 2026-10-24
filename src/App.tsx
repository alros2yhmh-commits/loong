import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type SessionRow, type Settings } from './lib/api'
import { useAgentStream, toHistory } from './lib/stream'
import { newId } from './lib/blocks'
import { Sidebar } from './components/Sidebar'
import { Composer, type Mode, type Trust } from './components/Composer'
import { Transcript } from './components/Transcript'
import { StatusBar } from './components/StatusBar'
import { SettingsPanel } from './components/SettingsPanel'

/* ===========================================================================
   The shell.

   Four regions in a fixed column: a 40px title bar with the session tabs, the
   sidebar on the left at 280px, the conversation column at 720px, and a 36px
   status bar pinned to the floor.

   The settings come from the server now (GET/PUT /api/settings), not from
   localStorage — a preference that does not survive a restart is not a
   preference.
   =========================================================================== */

const SIDEBAR_KEY = 'loong.sidebar.w'

function persistedWidth(): number {
  try {
    const v = Number(localStorage.getItem(SIDEBAR_KEY))
    return v >= 240 && v <= 400 ? v : 280
  } catch {
    return 280
  }
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [health, setHealth] = useState<boolean | null>(null)
  const [width, setWidth] = useState(persistedWidth)
  const [resizing, setResizing] = useState(false)
  const [runningIds, setRunningIds] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const dragFrom = useRef<{ x: number; w: number } | null>(null)

  const stream = useAgentStream()

  /* ---- settings: from the server, merged on write ---------------------- */
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

  /* ---- sessions and workspace ------------------------------------------ */
  const reload = useCallback(() => {
    void api.sessions().then((r) => setSessions(r.sessions ?? [])).catch(() => {})
    void api.workspace().then((r) => setWorkspace(r.workspace)).catch(() => {})
  }, [])

  useEffect(reload, [reload])

  useEffect(() => {
    const t = setInterval(() => void api.health().then((h) => setHealth(h.ok)).catch(() => setHealth(false)), 15000)
    void api.health().then((h) => setHealth(h.ok)).catch(() => setHealth(false))
    return () => clearInterval(t)
  }, [])

  /* ---- opening a thread ------------------------------------------------- */
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

  /* ---- running ---------------------------------------------------------- */
  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || !settings) return
    let id = activeId
    if (!id) {
      const created = await api.createSession(workspace ?? undefined).catch(() => null)
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
    stream.setBlocks([
      ...stream.blocks,
      { k: 'user', id: newId(), text, at: Date.now() },
    ])
    setRunningIds((prev) => (id && !prev.includes(id) ? [...prev, id] : prev))

    const threadId = id
    await stream.run({
      threadId,
      sessionId: id,
      messages: [...toHistory(stream.blocks), { role: 'user', content: text }],
      settings,
    })

    setRunningIds((prev) => prev.filter((x) => x !== threadId))
    void api.saveBlocks(threadId, stream.blocks).catch(() => {})
    void api.renameSession(threadId, text.slice(0, 60)).catch(() => {})
    reload()
  }, [input, settings, activeId, workspace, stream, reload])

  /* the transcript is persisted whenever it settles, not only on send */
  useEffect(() => {
    if (!activeId || stream.running || stream.blocks.length === 0) return
    const t = setTimeout(() => void api.saveBlocks(activeId, stream.blocks).catch(() => {}), 400)
    return () => clearTimeout(t)
  }, [activeId, stream.running, stream.blocks])

  /* ---- sidebar resize --------------------------------------------------- */
  const onResizeStart = useCallback((e: React.PointerEvent) => {
    dragFrom.current = { x: e.clientX, w: width }
    setResizing(true)
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }, [width])

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

  /* ---- the plan, for the status bar ------------------------------------- */
  const planCount = useMemo(() => {
    const planBlock = [...stream.blocks].reverse().find((b) => b.k === 'plan')
    if (!planBlock || planBlock.k !== 'plan') return null
    const steps = planBlock.plan.steps ?? []
    if (!steps.length) return null
    return { done: steps.filter((s) => s.status === 'done').length, total: steps.length }
  }, [stream.blocks])

  /* ---- keyboard: Ctrl+K opens the search -------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSidebarOpen(true)
        document.querySelector<HTMLInputElement>('[aria-label="Find a thread"]')?.focus()
      }
      if (e.key === 'Escape' && stream.running) stream.stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stream])

  const folderName = workspace ? (workspace.split(/[\\/]/).filter(Boolean).pop() ?? workspace) : null

  return (
    <div className="flex h-full w-full flex-col" style={{ background: 'var(--canvas)' }}>
      {/* ---- title bar 40px: session tabs and the pane buttons ------------- */}
      <header
        className="flex h-[40px] shrink-0 items-center gap-[8px] px-[12px]"
        style={{ borderBottom: '1px solid var(--line-1)' }}
      >
        <button
          type="button"
          className="ctl grid h-[26px] w-[26px] place-items-center rounded-[6px]"
          aria-label={sidebarOpen ? 'Hide the sidebar' : 'Show the sidebar'}
          title={sidebarOpen ? 'Hide the sidebar' : 'Show the sidebar'}
          onClick={() => setSidebarOpen((v) => !v)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6.5 3v10" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>

        <button
          type="button"
          className="ctl rounded-[8px] px-[11px] py-[5px] t-small"
          style={{ border: '1px solid var(--line-2)', color: 'var(--text-1)' }}
          onClick={() => void send()}
        >
          New thread
        </button>

        <span className="flex-1" />

        <button
          type="button"
          className="ctl grid h-[26px] w-[26px] place-items-center rounded-[6px]"
          aria-label="Changes"
          title="Changes"
          onClick={() => void api.gitDiff().then((d) => setNotice(d.diff ? `${d.files?.length ?? 0} file(s) changed` : 'no changes'))}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M4 3v10M12 3v10M4 8h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="ctl rounded-[6px] px-[8px] py-[3px] t-tiny"
          style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
          onClick={() => patch({ view: settings?.view === 'verbose' ? 'normal' : settings?.view === 'normal' ? 'thinking' : 'verbose' })}
          title="Transcript view — Normal, Thinking, Verbose"
        >
          {settings?.view ?? 'normal'}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          sessions={sessions}
          activeId={activeId}
          runningIds={runningIds}
          workspace={workspace}
          open={sidebarOpen}
          width={width}
          onToggle={() => setSidebarOpen((v) => !v)}
          onOpenThread={(id) => void openThread(id)}
          onNewThread={() => {
            setActiveId(null)
            stream.setBlocks([])
            setSidebarOpen(false)
          }}
          onNewProject={() => {
            const bridge = (window as unknown as { loong?: { pickWorkspace?: () => Promise<string | null> } }).loong
            if (bridge?.pickWorkspace) {
              void bridge.pickWorkspace().then((picked) => {
                if (picked) void api.setWorkspace(picked).then(() => setWorkspace(picked))
              })
            } else {
              setNotice('the folder picker needs the desktop shell')
            }
          }}
          onRename={(id, title) => {
            void api.renameSession(id, title).then(reload)
          }}
          onDelete={(id) => {
            void api.deleteSession(id).then(() => {
              if (activeId === id) {
                setActiveId(null)
                stream.setBlocks([])
              }
              reload()
            })
          }}
          onOpenMemory={() => setNotice('memory opens here')}
          onOpenSettings={() => setSettingsOpen(true)}
          onResizeStart={onResizeStart}
          onResizeReset={() => setWidth(280)}
          resizing={resizing}
        />

        <main className="relative flex min-w-0 flex-1 flex-col">
          {stream.error && (
            <div className="px-[24px] pt-[12px]">
              <p className="m-0 t-small" style={{ color: 'var(--text-1)' }}>
                {stream.error}
              </p>
              <button
                type="button"
                className="ctl mt-[6px] rounded-[8px] px-[11px] py-[5px] t-small"
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

          {notice && (
            <div className="px-[24px] pt-[12px]">
              <p className="m-0 t-small" style={{ color: 'var(--text-2)' }}>
                {notice}
              </p>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            <Transcript
              blocks={stream.blocks}
              view={settings?.view ?? 'normal'}
              running={stream.running}
              onDecide={(id, approved) => void api.decide(id, approved).catch(() => {})}
              onAnswer={(id, answer) => void api.answer(id, answer).catch(() => {})}
              onRetry={() => void send()}
            />
          </div>

          {settings && (
            <Composer
              value={input}
              onValueChange={setInput}
              onSend={() => void send()}
              onStop={stream.stop}
              running={stream.running}
              mode={settings.mode}
              trust={settings.trust}
              onModeChange={(m: Mode) => patch({ mode: m })}
              onTrustChange={(t: Trust) => patch({ trust: t })}
              folder={folderName}
              onPickFolder={() => {
                const bridge = (window as unknown as { loong?: { pickWorkspace?: () => Promise<string | null> } }).loong
                if (bridge?.pickWorkspace) {
                  void bridge.pickWorkspace().then((picked) => {
                    if (picked) void api.setWorkspace(picked).then(() => setWorkspace(picked))
                  })
                } else {
                  setNotice('the folder picker needs the desktop shell')
                }
              }}
              model={settings.model}
              onPickModel={() => setSettingsOpen(true)}
              disabled={health === false}
              placeholder={
                health === false
                  ? 'The agent is not running — start it and this will wake up.'
                  : settings.model
                    ? undefined
                    : 'Pick a model in Settings first…'
              }
            />
          )}
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

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings ?? DEFAULT}
        onChange={patch}
        health={health}
      />
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
