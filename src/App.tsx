import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, type SessionRow, type Settings } from './lib/api'
import { useSessionStreams, toHistory } from './lib/stream'
import { newId } from './lib/blocks'
import { Sidebar, type Surface } from './components/Sidebar'
import { Composer, type Mode, type Trust } from './components/Composer'
import { Transcript, EmptyState } from './components/Transcript'
import { StatusBar } from './components/StatusBar'
import { SettingsPanel } from './components/SettingsPanel'
import { CommandPalette } from './components/CommandPalette'
import { DiffPane } from './components/DiffPane'
import { InspectPanel, type InspectTab } from './components/InspectPanel'
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

/* Slash commands that do not switch a surface expand into a real prompt, so
   the agent's own tools do the work instead of the UI guessing. */
const PROMPT_SLASH: Record<string, string> = {
  verify:
    'Run this project’s verification now — its tests, typecheck and lint — and report exactly what passed and what failed. If none are configured, detect the stack and say which command would be right.',
  scan: 'Run a security scan of this folder, then explain the most severe findings and how to fix them.',
  explain:
    'Explain the structure of this folder: what each top-level part does and how the parts connect. Use the graph tools rather than reading every file.',
}

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
  /* every session with an in-memory transcript, plus which tabs the reader has
     arranged. Tabs are the window's arrangement; the transcript itself lives in
     the per-session registry below, so closing a tab never stops another one. */
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<File[]>([])
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [modelPicker, setModelPicker] = useState(false)
  const [inspect, setInspect] = useState<InspectTab | null>(null)
  /* the badge on Changes: how many files differ, so the button answers "did
     anything actually happen?" before it is even pressed */
  const [changedCount, setChangedCount] = useState(0)
  const [findingSummary, setFindingSummary] = useState<{ open: number; critical: number } | null>(null)
  const dragFrom = useRef<{ x: number; w: number } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const streams = useSessionStreams(activeId)
  /* the visible slot — every reader below sees one thread, but the registry
     keeps the others streaming */
  const stream = {
    blocks: streams.view.blocks,
    running: streams.view.running,
    phase: streams.view.phase,
    error: streams.view.error,
    usage: streams.view.usage,
  }
  const runningIds = streams.runningIds

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

  /* ---- tabs ---------------------------------------------------------------
     A tab is an arrangement, not a run. Opening one never aborts another, and
     closing one stops only the work that tab owns. */
  const openTab = useCallback((id: string) => {
    setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }, [])

  const newThread = useCallback(() => setActiveId(null), [])

  const closeTab = useCallback(
    (id: string) => {
      streams.stop(id)
      streams.drop(id)
      const idx = openTabs.indexOf(id)
      const next = openTabs.filter((x) => x !== id)
      setOpenTabs(next)
      if (activeId === id) setActiveId(next[Math.max(0, idx - 1)] ?? null)
    },
    [streams, openTabs, activeId],
  )

  /* ---- opening a thread -------------------------------------------------- */
  const openThread = useCallback(
    async (id: string) => {
      setActiveId(id)
      openTab(id)
      /* a session belongs to a project: opening it opens that folder, so the
         agent can never read the previous session's project by accident */
      const row = sessions.find((s) => s.id === id)
      if (row?.workspace && row.workspace !== workspace) {
        void api
          .setWorkspace(row.workspace)
          .then(() => setWorkspace(row.workspace))
          .catch(() => {})
      }
      /* a live transcript in this window is newer than its disk copy */
      if (streams.loaded(id)) return
      try {
        const blocks = await api.loadBlocks(id)
        streams.setBlocks(id, blocks as never)
      } catch {
        streams.setBlocks(id, [])
      }
    },
    [sessions, workspace, streams, openTab],
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
  /* A text file is read and inlined. An image is embedded as a data URL (capped,
     so a huge screenshot does not blow the context). Anything else is attached as
     a named reference the agent can act on — nothing is dropped silently. */
  const TEXT_RE = /\.(md|txt|json|ts|tsx|js|jsx|css|html|yml|yaml|csv|log|toml|py|go|rs|java|c|h|cpp|sh)$/i
  const readAttachments = useCallback(async (): Promise<{ body: string; refused: string[] }> => {
    const refused: string[] = []
    const parts: string[] = []
    for (const f of attachments) {
      const isText = f.type.startsWith('text/') || TEXT_RE.test(f.name)
      if (isText) {
        if (f.size > 200_000) {
          refused.push(`${f.name} (too large to read)`)
          continue
        }
        const body = await f.text()
        parts.push(`--- ${f.name} ---\n${body}`)
        continue
      }
      if (f.type.startsWith('image/')) {
        if (f.size > 1_500_000) {
          parts.push(`--- ${f.name} (image, ${Math.round(f.size / 1024)}KB, too large to embed) ---`)
          continue
        }
        const buf = await f.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        const dataUrl = `data:${f.type};base64,${btoa(bin)}`
        parts.push(`--- ${f.name} (image) ---\n![${f.name}](${dataUrl})`)
        continue
      }
      /* other binary — a reference the agent can mention or act on */
      parts.push(`--- ${f.name} (${f.type || 'file'}, ${Math.round(f.size / 1024)}KB) ---\n[attached file — reference only, not inlined]`)
    }
    return { body: parts.join('\n\n'), refused }
  }, [attachments])

  const send = useCallback(async () => {
    const raw = input.trim()
    const slash = /^\/([a-z-]+)\s*$/i.exec(raw)
    /* a slash line is an instruction to the app; handled here so it never
       becomes a user turn the model has to interpret */
    if (slash) {
      const name = slash[1].toLowerCase()
      if (name === 'clear') {
        /* a new thread, not a destroyed one: every other tab keeps its work */
        setActiveId(null)
        setInput('')
        return
      }
      if (name === 'changes') {
        setDiffOpen(true)
        setInput('')
        return
      }
      if (name === 'graph' || name === 'inspect') {
        setInspect('graph')
        setInput('')
        return
      }
      if (name === 'security' || name === 'findings') {
        setInspect('security')
        setInput('')
        return
      }
      if (name === 'help') {
        setNotice(
          '/verify · /scan · /graph · /changes · /security · /explain · /clear — or just type the task.',
        )
        setInput('')
        return
      }
    }
    const typed = slash ? (PROMPT_SLASH[slash[1].toLowerCase()] ?? raw) : raw
    const { body: attached, refused } = await readAttachments()
    const text = [typed, attached].filter(Boolean).join('\n\n')
    if (!text || !settings) return
    if (refused.length) {
      setNotice(`could not attach: ${refused.join(', ')}`)
    }
    setAttachments([])
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
    const initial = [...stream.blocks, { k: 'user' as const, id: newId(), text, at: Date.now() }]
    streams.setBlocks(id, initial)
    openTab(id)

    /* the run belongs to `id` from here on. If the reader switches tabs while
       it works, this promise still resolves into that session's slot — the
       visible transcript is a view of the registry, not the run itself. */
    const threadId = id
    await streams.run({
      threadId,
      sessionId: id,
      messages: toHistory(initial),
      initialBlocks: initial,
      settings: { ...settings, mode: effectiveMode },
    })

    /* an attachment-only turn has no typed text — name the thread after the file
       instead of after its contents */
    void api.renameSession(threadId, (typed || attachments[0]?.name || text).slice(0, 60)).catch(() => {})
    reload()
  }, [input, settings, activeId, workspace, surface, effectiveMode, streams, reload, readAttachments, openTab])

  /** retry the last run: strip any trailing failure blocks and re-run the
      same history without adding a new user turn */
  const retry = useCallback(async () => {
    if (!settings || !activeId) return
    /* remove trailing failure/noise blocks so the transcript is clean */
    const clean = stream.blocks.slice()
    while (clean.length > 0) {
      const last = clean[clean.length - 1]
      if (last.k === 'failed' || last.k === 'stop' || last.k === 'notice') {
        clean.pop()
      } else {
        break
      }
    }
    /* drop the agent's own last answer(s) so the retry re-attempts the task
       instead of regenerating the same text it just produced */
    while (clean.length > 0 && clean[clean.length - 1].k === 'text') {
      clean.pop()
    }
    if (clean.length === 0) return
    const threadId = activeId
    streams.setBlocks(threadId, clean)
    await streams.run({
      threadId,
      sessionId: threadId,
      messages: toHistory(clean),
      initialBlocks: clean,
      settings: { ...settings, mode: effectiveMode },
    })
    reload()
  }, [settings, activeId, effectiveMode, streams, reload])

  /* Persistence lives in the stream registry now: it saves each thread under
     its own id when that thread's run settles, so two sessions settling at once
     cannot write over each other. */

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
    if (near) el.scrollTo({ top: el.scrollHeight, behavior: 'auto' })
  }, [stream.blocks])

  /* The scroller remounts per thread, and a fresh node starts at scrollTop 0 —
     for a tail-windowed transcript that is its oldest visible block, not the
     newest turn. A mount therefore lands at the bottom; the follow effect above
     takes over from there. */
  const attachScroller = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  /* ---- the plan, for the floor bar --------------------------------------- */
  const planCount = useMemo(() => {
    const planBlock = [...stream.blocks].reverse().find((b) => b.k === 'plan')
    if (!planBlock || planBlock.k !== 'plan') return null
    const steps = planBlock.plan.steps ?? []
    if (!steps.length) return null
    return { done: steps.filter((s) => s.status === 'done').length, total: steps.length }
  }, [stream.blocks])

  /* the last cycle phase and graph size the run reported, for the floor bar */
  const cyclePhase = useMemo(() => {
    for (let i = stream.blocks.length - 1; i >= 0; i--) {
      const b = stream.blocks[i]
      if (b.k === 'cycle') return b.phase
    }
    return null
  }, [stream.blocks])

  const graphFiles = useMemo(() => {
    for (let i = stream.blocks.length - 1; i >= 0; i--) {
      const b = stream.blocks[i]
      if (b.k === 'graph') return b.files
    }
    return null
  }, [stream.blocks])

  /* ---- the ledger and change count behind the floor bar ------------------ */
  const refreshFindings = useCallback(() => {
    if (!workspace) {
      setFindingSummary(null)
      return
    }
    void api
      .findings()
      .then((r) => setFindingSummary({ open: r.counts.open, critical: r.counts.critical }))
      .catch(() => {})
  }, [workspace])

  const refreshChanges = useCallback(() => {
    if (!workspace) {
      setChangedCount(0)
      return
    }
    void api
      .gitDiff()
      .then((r) => {
        if (r.ok !== false) setChangedCount((r.files ?? []).length)
      })
      .catch(() => {})
  }, [workspace])

  useEffect(() => {
    refreshFindings()
    refreshChanges()
  }, [refreshFindings, refreshChanges])

  /* a run writes files and can add findings: both badges are stale when it ends */
  useEffect(() => {
    if (stream.running) return
    refreshFindings()
    refreshChanges()
  }, [stream.running, refreshFindings, refreshChanges])

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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !e.shiftKey) {
        e.preventDefault()
        newThread()
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        setDiffOpen(true)
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        setInspect((v) => (v ? null : 'graph'))
      }
      if (e.key === 'Escape' && activeId && stream.running) streams.stop(activeId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stream, streams, activeId, newThread])

  const folderName = workspace ? (workspace.split(/[\\/]/).filter(Boolean).pop() ?? workspace) : null
  const blockedReason =
    health === false
      ? 'agent offline'
      : !settings?.model
        ? 'no model'
        : !workspace
          ? 'choose a folder'
          : null
  const liveHere = Boolean(activeId && runningIds.includes(activeId) && stream.running)


  const composer = settings ? (
    <Composer
      value={input}
      onValueChange={setInput}
      onSend={() => void send()}
      onStop={() => {
        if (activeId) streams.stop(activeId)
      }}
      running={stream.running}
      mode={effectiveMode}
      trust={settings.trust}
      folder={folderName}
      showFolder={surface === 'code'}
      onPickFolder={pickFolder}
      model={settings.model}
      onPickModel={() => setModelPicker(true)}
      attachments={attachments}
      onAttach={(files) => setAttachments((prev) => [...prev, ...files])}
      onRemoveAttachment={(i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
      blockedReason={blockedReason}
      onOpenModeMenu={() => {
        const el = document.querySelector('[aria-label="Permission mode"]')
        const r = el?.getBoundingClientRect()
        setModeMenu(r ? { x: r.left, y: r.top } : { x: 200, y: window.innerHeight - 120 })
      }}
    />
  ) : null


  return (
    <div
      className="shell flex h-full w-full flex-col"
      style={{
        /* The dotted canvas + its slow drift live on `.shell` (global.css); the
           grain overlay is the `.grain` child below. One knob the whole type
           ramp hangs off of: the app root's font-size, so the Thread-text
           slider actually moves text instead of being a number nothing reads. */
        fontSize: `${settings?.fontSize ?? 14}px`,
      }}
    >
      {/* ---- the title bar 44px ------------------------------------------- */}
      <header
        className="flex h-[38px] shrink-0 items-center gap-[10px] pl-[12px] pr-[146px]"
        style={{
          borderBottom: '1px solid var(--line-1)',
          background: 'var(--canvas)',
          /* the whole strip drags the window; every control inside opts out */
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        <button
          type="button"
          className="ctl grid h-[24px] w-[24px] place-items-center rounded-[6px]"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
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

        {surface === 'code' && (
          <>
                <button
                  type="button"
                  className="ctl flex shrink-0 items-center gap-[5px] rounded-[6px] px-[8px] py-[3px] t-tiny"
                  style={
                    {
                      color: findingSummary && findingSummary.critical > 0 ? 'var(--fail)' : 'var(--text-3)',
                      border: '1px solid var(--line-2)',
                      WebkitAppRegion: 'no-drag',
                    } as React.CSSProperties
                  }
                  onClick={() => setInspect('graph')}
                  title="Inspect the project — graph and security findings — Ctrl Shift G"
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M10.2 10.2L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                  Inspect
                </button>
                <button
                  type="button"
                  className="ctl flex shrink-0 items-center gap-[5px] rounded-[6px] px-[8px] py-[3px] t-tiny"
                  /* the whole strip drags the window, so every control inside it
                     has to opt out or the click is swallowed */
                  style={
                    {
                      color: 'var(--text-3)',
                      border: '1px solid var(--line-2)',
                      WebkitAppRegion: 'no-drag',
                    } as React.CSSProperties
                  }
                  onClick={() => setDiffOpen(true)}
                  title="Review changes in this folder — Ctrl Shift D"
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d="M7 2.5l-4 5 4 5M9 2.5l4 5-4 5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Changes
                  {changedCount > 0 && (
                    <span className="mono rounded-[4px] px-[3px] t-tiny" style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
                      {changedCount}
                    </span>
                  )}
                </button>
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
            /* runs keep going: leaving a surface is navigation, not a stop */
            setSurface(next)
            setActiveId(null)
          }}
          onOpenThread={(id) => void openThread(id)}
          onNewThread={newThread}
          onRename={(id, title) => void api.renameSession(id, title).then(reload)}
          onDelete={(id) => setDeleteTarget(id)}
          onOpenSettings={() => setSettingsOpen(true)}
          onSearch={() => setPaletteOpen(true)}
          onResizeStart={onResizeStart}
          onResizeReset={() => setWidth(272)}
          resizing={resizing}
        />

        <main className="relative flex min-w-0 flex-1 flex-col">
          {/* Open sessions, side by side. The strip appears as soon as there is
              more than one, and every tab keeps its own run alive underneath. */}
          {surface === 'code' && openTabs.length > 1 && (
            <div
              className="flex h-[34px] shrink-0 items-stretch gap-[1px] overflow-x-auto px-[8px]"
              style={{ borderBottom: '1px solid var(--line-1)', background: 'var(--canvas)' }}
              role="tablist"
              aria-label="Open sessions"
            >
              {openTabs.map((id) => {
                const row = sessions.find((s) => s.id === id)
                const title = row?.title ?? 'Thread'
                const live = runningIds.includes(id)
                const active = activeId === id
                return (
                  <div
                    key={id}
                    className="group flex min-w-0 shrink-0 items-center rounded-t-[7px]"
                    style={{
                      background: active ? 'var(--surface)' : 'transparent',
                      boxShadow: active ? 'inset 0 -1px 0 var(--amber)' : 'none',
                    }}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => void openThread(id)}
                      title={title}
                      className="flex min-w-0 items-center gap-[6px] px-[9px] py-[7px] t-tiny"
                      style={{ color: active ? 'var(--text-1)' : 'var(--text-3)' }}
                    >
                      {live ? (
                        <motion.span
                          className="inline-block h-[5px] w-[5px] shrink-0 rounded-full"
                          style={{ background: 'var(--amber)' }}
                          animate={{ opacity: [1, 0.3, 1] }}
                          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                        />
                      ) : (
                        <span
                          className="inline-block h-[5px] w-[5px] shrink-0 rounded-full"
                          style={{ background: active ? 'var(--line-4)' : 'var(--line-3)' }}
                        />
                      )}
                      <span className="max-w-[170px] truncate">{title}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => closeTab(id)}
                      aria-label={`Close ${title}`}
                      title="Close this tab — stops its run"
                      className="ctl mr-[5px] grid h-[17px] w-[17px] shrink-0 place-items-center rounded-[4px] opacity-60 group-hover:opacity-100"
                      style={{ color: 'var(--text-3)' }}
                    >
                      <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden>
                        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                )
              })}
              <button
                type="button"
                onClick={newThread}
                aria-label="New session"
                title="New session — Ctrl N"
                className="ctl my-[6px] ml-[3px] grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[6px]"
                style={{ color: 'var(--text-3)' }}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )}

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
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="px-[24px] pt-[12px]"
            >
              <p className="m-0 t-small" style={{ color: 'var(--text-1)' }}>
                {stream.error}
              </p>
              <button
                type="button"
                className="ctl mt-[6px] rounded-[8px] px-[12px] py-[5px] t-small"
                style={{ border: '1px solid var(--line-3)', color: 'var(--text-1)' }}
                onClick={() => {
                  streams.clearError(activeId ?? undefined)
                  if (stream.blocks.some((b) => b.k === 'user')) void retry()
                  else void send()
                }}
              >
                Retry
              </button>
            </motion.div>
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
            <AnimatePresence mode="wait" initial={false}>
              {stream.blocks.length === 0 ? (
                <motion.div
                  key={`empty-${activeId ?? 'new'}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  <EmptyState running={liveHere} onPick={setInput} />
                </motion.div>
              ) : (
                <motion.div
                  key={activeId ?? 'thread'}
                  ref={attachScroller}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="min-h-0 flex-1 overflow-y-auto"
                >
                  <Transcript
                    bare
                    blocks={stream.blocks}
                    view={settings?.view ?? 'normal'}
                    running={liveHere}
                    phase={stream.phase}
                    onDecide={(id, approved) => void api.decide(id, approved).catch(() => {})}
                    onAnswer={(id, answer) => void api.answer(id, answer).catch(() => {})}
                    onRetry={() => void retry()}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div className={stream.blocks.length === 0 ? 'w-full' : 'shrink-0 pb-[18px] pt-[10px]'}>
              {composer}
            </div>
          </div>
        </main>
      </div>

      <StatusBar
        running={liveHere}
        phase={stream.phase}
        mode={settings?.mode ?? 'agent'}
        model={stream.usage?.model ?? settings?.model ?? ''}
        plan={planCount}
        workspace={workspace}
        usage={stream.usage}
        health={health}
        cycle={cyclePhase}
        security={findingSummary}
        graphFiles={graphFiles}
        onInspect={(tab) => setInspect(tab)}
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
        onNewThread={newThread}
        onPickFolder={pickFolder}
      />

      {diffOpen && (
        <DiffPane onClose={() => setDiffOpen(false)} workspace={workspace} onCount={setChangedCount} />
      )}

      <AnimatePresence>
        {inspect && (
          <InspectPanel
            tab={inspect}
            workspace={workspace}
            onClose={() => setInspect(null)}
            onTab={setInspect}
          />
        )}
      </AnimatePresence>

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
                      streams.drop(id)
                      setOpenTabs((prev) => prev.filter((x) => x !== id))
                      if (activeId === id) setActiveId(null)
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

      {/* the grain overlay — a faint tooth over the whole window, never interactive */}
      <div className="grain" />
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
