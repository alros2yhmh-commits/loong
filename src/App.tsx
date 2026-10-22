import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Composer } from './components/Composer'
import { CommandPalette, type Command } from './components/CommandPalette'
import { ArtifactsPanel, countArtifacts } from './components/ArtifactsPanel'
import { Noise } from './components/Noise'
import { Rail } from './components/Rail'
import { Resizer } from './components/Resizer'
import { RunBar } from './components/RunBar'
import { RunStatus } from './components/RunStatus'
import { StudioStrip } from './components/StudioStrip'
import { Settings } from './components/Settings'
import { Thread } from './components/Thread'
import { ThreadDrawer } from './components/ThreadDrawer'
import { SelectionBar, type SelectionAction } from './components/SelectionBar'
import { AgentsPanel } from './components/AgentsPanel'
import { ReviewPanel } from './components/ReviewPanel'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Welcome } from './components/Welcome'
import { IconFolder } from './components/Icons'
import type { Session } from './lib/contract'
import {
  api,
  type Health,
  type LocalModel,
  type RemoteModel,
  type ServerConfig,
  type ServerSession,
} from './lib/api'
import { useSettings } from './lib/settings'
import { keyForRun } from './lib/keys'
import { sound } from './lib/sound'
import { useAgentStream } from './lib/useAgentStream'
import { pickModel, routableFrom } from './lib/router'
import { suggestionsFor } from './lib/suggestions'
import { useDragSize } from './lib/useDragSize'
import { useEdgeReveal } from './lib/useEdgeReveal'
import { dur, easeOut } from './motion/tokens'

/** a stored thread, shaped for the drawer */
function toSession(s: ServerSession): Session {
  const mins = Math.round((Date.now() - s.updatedAt) / 60_000)
  return {
    id: s.id,
    title: s.title,
    preview: s.model ? `${s.provider ?? 'local'} · ${s.model}` : 'No runs yet',
    age:
      mins < 1
        ? 'now'
        : mins < 60
          ? `${mins}m`
          : mins < 1440
            ? `${Math.round(mins / 60)}h`
            : `${Math.round(mins / 1440)}d`,
    workspace: s.workspace,
  }
}

export default function App() {
  const { settings, set, provider } = useSettings()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [health, setHealth] = useState<Health | null>(null)
  const [models, setModels] = useState<LocalModel[]>([])
  const [remoteModels, setRemoteModels] = useState<RemoteModel[]>([])
  const [sessions, setSessions] = useState<ServerSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  /* split view: a second thread open beside the first. null means a single column */
  const [splitId, setSplitId] = useState<string | null>(null)
  /* which pane the composer, run bar and shortcuts drive */
  const [splitFocus, setSplitFocus] = useState<'primary' | 'secondary'>('primary')
  const [loadingThread, setLoadingThread] = useState(false)
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [mode, setMode] = useState<'ask' | 'plan' | 'agent'>('agent')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  /* the key for a run, when there is one in this context — dev only; packaged
     runs resolve their key in the agent process */
  const [runKey, setRunKey] = useState<string | undefined>(undefined)

  useEffect(() => {
    let alive = true
    const refresh = () => {
      void keyForRun(settings.provider).then((k) => {
        if (alive) setRunKey(k)
      })
    }
    refresh()
    /* a key saved in Settings must reach the NEXT run — not the next launch */
    window.addEventListener('loong:keys-changed', refresh)
    return () => {
      alive = false
      window.removeEventListener('loong:keys-changed', refresh)
    }
  }, [settings.provider])

  const railSize = useDragSize({ key: 'loong.rail.w', initial: 52, min: 46, max: 132 })
  const measure = useDragSize({
    key: 'loong.thread.w',
    initial: 660,
    min: 420,
    max: 1120,
  })
  const drawerSize = useDragSize({
    key: 'loong.drawer.w',
    initial: 320,
    min: 240,
    max: 560,
    invert: true,
  })
  /* the width of the right-hand pane in split view; anchored to the right edge */
  const splitSize = useDragSize({
    key: 'loong.split.w',
    initial: 520,
    min: 320,
    max: 900,
    invert: true,
  })

  const config: ServerConfig = useMemo(
    () => ({
      provider: settings.provider,
      model: settings.model,
      /* in the packaged app the key lives in the OS keychain and the agent
         reads it itself — the renderer only ever holds one in dev */
      apiKey: runKey,
      baseUrl: settings.baseUrl || undefined,
    }),
    [settings.provider, settings.model, runKey, settings.baseUrl],
  )

  const refreshSessions = useCallback(async () => {
    try {
      const { sessions: rows } = await api.sessions()
      setSessions(rows)
      return rows
    } catch {
      /* the agent process is optional; the app still runs without it */
      return null
    }
  }, [])

  /* ---- the router: the model for THIS message, not for all of them --------
     Declared before the stream it feeds: the router's answer is resolved once,
     at send time, so a run never changes model halfway through. */

  const routerModels = useMemo(
    () => routableFrom(models, remoteModels),
    [models, remoteModels],
  )
  const pickForSend = useCallback(
    (text: string) =>
      pickModel(settings.route, text, routerModels.local, routerModels.remote),
    [settings.route, routerModels],
  )

  /* Two stream instances, one per pane. The store is keyed by thread id, so a
     run in one pane keeps streaming while the reader works in the other — and
     the agents workbench merges what both report. The composer, run bar, title
     and shortcuts all follow whichever pane is focused. */
  const confidenceGate = useMemo(
    () =>
      settings.trust === 'auto'
        ? { threshold: settings.confidenceThreshold, decisionModel: settings.decisionModel }
        : undefined,
    [settings.trust, settings.confidenceThreshold, settings.decisionModel],
  )
  const primary = useAgentStream({
    config,
    sessionId: activeId,
    mode,
    trust: settings.trust,
    confidence: confidenceGate,
    /* the router picks the model per message; null means "keep the configured
       one" (manual route, or nothing tool-capable to route to) */
    pickModel: pickForSend,
    userName: settings.userName,
    onAssistantDone: refreshSessions,
  })
  const secondary = useAgentStream({
    config,
    sessionId: splitId,
    mode,
    trust: settings.trust,
    confidence: confidenceGate,
    pickModel: pickForSend,
    userName: settings.userName,
    onAssistantDone: refreshSessions,
  })
  const primaryRef = useRef(primary)
  primaryRef.current = primary
  const secondaryRef = useRef(secondary)
  secondaryRef.current = secondary

  const stream = splitFocus === 'secondary' && splitId ? secondary : primary
  const streamRef = useRef(stream)
  streamRef.current = stream

  /* the thread the header, the send and retry act on — the focused pane's */
  const focusedId = splitFocus === 'secondary' && splitId ? splitId : activeId

  /* ---- opening a thread ------------------------------------------------- */

  /** show the thread's live column if it has one, otherwise load what was stored */
  const openThread = useCallback(async (id: string) => {
    setSplitFocus('primary')
    setActiveId(id)
    setLoadingThread(true)
    try {
      const { messages } = await api.messages(id)
      /* the reader may have clicked elsewhere while this was in flight */
      setActiveId((current) => {
        if (current === id) primaryRef.current.load(messages, id)
        return current
      })
    } catch {
      /* an unreadable thread is left empty rather than wrong */
    } finally {
      setLoadingThread(false)
    }
  }, [])

  /** open a thread into the right-hand pane and focus it — the second column */
  const openSplit = useCallback(async (id: string) => {
    setSplitId(id)
    setSplitFocus('secondary')
    try {
      const { messages } = await api.messages(id)
      secondaryRef.current.load(messages, id)
    } catch {
      /* an unreadable thread is left empty rather than wrong */
    }
  }, [])

  const closeSplit = useCallback(() => {
    setSplitId(null)
    setSplitFocus('primary')
  }, [])

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const createThread = useCallback(async () => {
    try {
      const { session } = await api.createSession({
        provider: settings.provider,
        model: settings.model,
        workspace: workspace ?? undefined,
      })
      setSessions((prev) => [session, ...prev])
      setActiveId(session.id)
      setSplitFocus('primary')
      return session.id
    } catch {
      setActiveId(null)
      return null
    }
  }, [settings.provider, settings.model])

  /**
   * Delete a thread, for good.
   *
   * The one action in Loong that cannot be undone, so it gets a real gate (the
   * ConfirmDialog) and a careful teardown: a running turn is stopped before its
   * files are pulled out from under it, the stream column is dropped, and the
   * reader lands on a neighbour rather than a blank window.
   */
  const deleteThread = useCallback(
    async (id: string) => {
      if (!id) return
      /* never yank the files out from under a turn still writing them */
      primary.stop(id)
      secondary.stop(id)
      try {
        await api.deleteSession(id)
      } catch {
        /* drop it locally even if the delete round trip failed — the drawer
           already reflects what the reader asked for */
      }
      setSessions((prev) => prev.filter((s) => s.id !== id))
      primary.reset(id)
      secondary.reset(id)
      if (splitId === id) closeSplit()
      if (activeId === id) {
        const next = sessions.find((s) => s.id !== id)?.id
        if (next) await openThread(next)
        else await createThread()
      }
    },
    [primary, secondary, splitId, closeSplit, activeId, sessions, openThread, createThread],
  )

  /** rename a stored thread in place — the drawer edits it, this persists it */
  const renameThread = useCallback(async (id: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    /* optimistic: the drawer already shows the new name, so put it in state
       before the round trip and correct it if the server disagrees */
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title: trimmed } : s)),
    )
    try {
      const { session } = await api.renameSession(id, trimmed)
      setSessions((prev) => prev.map((s) => (s.id === id ? session : s)))
    } catch {
      /* leave the optimistic title; the next refresh reconciles it */
    }
  }, [])

  /**
   * Rename the thread shown in the header.
   *
   * A brand-new app has no session yet — the first message creates one — so
   * renaming before that has to create the thread first, or the name would be
   * written nowhere.
   */
  const renameActive = useCallback(
    async (title: string) => {
      const trimmed = title.trim()
      if (!trimmed) return
      let id = focusedId
      if (!id) id = await createThread()
      if (!id) return
      await renameThread(id, trimmed)
    },
    [focusedId, createThread, renameThread],
  )

  /* ---- workspace -------------------------------------------------------- */

  /**
   * The picker was wired to a state nothing rendered. In the packaged app the
   * native dialog is the right control; in a browser there is no bridge, so a
   * path prompt is the honest fallback.
   */
  const changeWorkspace = useCallback(async () => {
    const bridge = (
      window as unknown as {
        loong?: { pickWorkspace?: () => Promise<string | null> }
      }
    ).loong
    try {
      if (bridge?.pickWorkspace) {
        const picked = await bridge.pickWorkspace()
        if (!picked) return
        setWorkspace(picked)
        /* the main process restarts the sidecar with the new root, so wait for
           health to report it instead of racing the restart */
        for (let i = 0; i < 24; i++) {
          try {
            const h = await api.health()
            if (h.workspace === picked) {
              setHealth(h)
              break
            }
          } catch {
            /* the sidecar is between processes */
          }
          await new Promise((r) => setTimeout(r, 250))
        }
        return
      }
      const typed = window.prompt(
        'Workspace folder (absolute path)',
        workspace ?? '',
      )
      if (!typed) return
      const res = await api.setWorkspace(typed)
      setWorkspace(res.workspace)
      setHealth(await api.health())
    } catch (err) {
      console.error('[loong] workspace change failed:', err)
    }
  }, [workspace])

  /* ---- first paint ------------------------------------------------------ */

  useEffect(() => {
    let alive = true
    const probe = async () => {
      try {
        const h = await api.health()
        if (alive) {
          setHealth(h)
          if (h.workspace) setWorkspace(h.workspace)
        }
      } catch {
        if (alive) setHealth(null)
      }
    }
    const loadModels = async () => {
      try {
        const { models: list } = await api.models()
        if (alive) setModels(list)
      } catch {
        /* no local daemon, no list */
      }
    }
    probe()
    loadModels()
    void (async () => {
      const rows = await refreshSessions()
      if (!alive || rows === null) return
      /* reopen the thread the reader was last in, so the app never starts on a
         blank column when there is work to come back to */
      if (rows.length > 0) await openThread(rows[0].id)
      else await createThread()
    })()
    const t = window.setInterval(probe, 20_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [refreshSessions, openThread, createThread])

  /* the OpenRouter catalogue is fetched once, and again if the provider is
     switched to it — the list changes weekly, so it is never baked in */
  useEffect(() => {
    if (settings.provider !== 'openrouter') return
    let alive = true
    void (async () => {
      try {
        const { models: list } = await api.openrouterModels()
        if (alive) setRemoteModels(list)
      } catch {
        /* the fallback suggestions in settings stay usable */
      }
    })()
    return () => {
      alive = false
    }
  }, [settings.provider])

  useEffect(() => {
    const arm = () => sound.unlock()
    window.addEventListener('pointerdown', arm, { once: true })
    return () => window.removeEventListener('pointerdown', arm)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  useEffect(() => {
    sound.setEnabled(settings.soundEnabled)
    sound.setVolume(settings.volume)
  }, [settings.soundEnabled, settings.volume])

  const toggleSound = useCallback(() => {
    set('soundEnabled', !settings.soundEnabled)
  }, [set, settings.soundEnabled])

  /* every turn needs somewhere to be written down, so a thread is created on
     demand rather than the first message being thrown away */
  const sendMessage = useCallback(
    async (text: string, images: string[] = []) => {
      const trimmed = text.trim()
      if (!trimmed) return

      /* a run in flight no longer loses the message: it waits its turn */
      if (streamRef.current.running) {
        setQueued({ text: trimmed, images })
        return
      }

      /* slash commands belong to the interface, not to the model: they act on
         the app itself and never cost a turn */
      if (trimmed.startsWith('/')) {
        const [cmd, ...rest] = trimmed.slice(1).split(/\s+/)
        const arg = rest.join(' ')
        switch (cmd) {
          case 'clear':
            streamRef.current.reset()
            await createThread()
            return
          case 'delete':
            /* destructive — the same ConfirmDialog gate as the drawer's button */
            if (focusedId) setDeleteTarget(focusedId)
            return
          case 'help':
            streamRef.current.inject(
              [
                'Loong (龙) — built by Professor Hamza Mahmoud Ramadan.',
                '',
                '`/clear` — start a fresh thread',
                '/delete — delete this thread (asks first) — confirm before it goes',
                '`/model <name>` — switch model (or /model to open Settings)',
                '`/workspace` — choose the folder the agent works in',
                '`/help` — this list',
                '',
                '⌘K palette · ⌘, settings · ⌘N new thread · ⌘B saved threads',
              ].join('\n'),
            )
            return
          case 'model':
            if (arg) set('model', arg)
            else setSettingsOpen(true)
            return
          case 'workspace':
            await changeWorkspace()
            return
          default: {
            /* a saved command is a prompt, not an app action — expand it and
               drop it in the composer for the reader to send or edit */
            const saved = settings.commands.find((c) => c.name === cmd)
            if (saved) {
              const expanded = saved.prompt.replaceAll('$ARGUMENTS', arg)
              setPrefill({ text: expanded, at: Date.now() })
              return
            }
            streamRef.current.inject(
              `Unknown command \`/${cmd}\`. Send \`/help\` for the list.`,
            )
            return
          }
        }
      }

      let id = focusedId
      if (!id) id = await createThread()
      setPinTail((n) => n + 1)
      await streamRef.current.send(trimmed, images, id ?? undefined)
    },
    [focusedId, createThread, changeWorkspace, set, settings.commands],
  )

  /* the queue drains the moment the turn ends — the thought was had, it does
     not get thrown away because the agent was busy */
  const sendRef = useRef(sendMessage)
  sendRef.current = sendMessage
  const [queued, setQueued] = useState<{ text: string; images: string[] } | null>(null)

  /* carried text from a selection in the thread — the composer is where it lands */
  const [prefill, setPrefill] = useState<{ text: string; at: number } | null>(null)
  /* bumps on every send; the focused pane reads it and snaps its view to the tail */
  const [pinTail, setPinTail] = useState(0)
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (stream.running || !queued) return
    const next = queued
    setQueued(null)
    void sendRef.current(next.text, next.images)
  }, [stream.running, queued])

  const drawer = useEdgeReveal({ zone: 4, width: drawerSize.size, grace: 320 })

  /* ---- the run bar: goal, plan, clock, context budget -------------------- */

  /* the compaction budget the agent enforces (server/context.ts). Same number
     here so the meter in the bar and the summary in the runtime agree. */
  const HISTORY_BUDGET = 24_000

  const goal = useMemo(() => {
    for (let i = stream.blocks.length - 1; i >= 0; i--) {
      const b = stream.blocks[i]
      if (b.k === 'user' && b.text.trim()) return b.text
    }
    return ''
  }, [stream.blocks])

  const currentPlan = useMemo(() => {
    for (let i = stream.blocks.length - 1; i >= 0; i--) {
      const b = stream.blocks[i]
      if (b.k === 'plan') return b.plan
    }
    return null
  }, [stream.blocks])

  const lastAssistant = useMemo(() => {
    for (let i = stream.blocks.length - 1; i >= 0; i--) {
      const b = stream.blocks[i]
      if (b.k === 'text' && b.text.trim()) return b.text
    }
    return ''
  }, [stream.blocks])

  const suggestions = useMemo(
    () => suggestionsFor(lastAssistant, { running: stream.running, mode }),
    [lastAssistant, stream.running, mode],
  )

  const historyChars = useMemo(() => {
    let n = 0
    for (const b of stream.blocks) {
      if (b.k === 'user' || b.k === 'text' || b.k === 'thinking') n += b.text.length
      else if (b.k === 'tool' && b.result) n += b.result.output.length
    }
    return n
  }, [stream.blocks])

  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  useEffect(() => {
    if (stream.running) setRunStartedAt((t) => t ?? Date.now())
  }, [stream.running])

  /* ---- checkpoints: a run can be undone ---------------------------------- */

  const [checkpoints, setCheckpoints] = useState<
    { runId: string; at: number; files: number; ops: number }[]
  >([])

  const loadCheckpoints = useCallback(() => {
    void api
      .checkpoints()
      .then((r) => setCheckpoints(r.checkpoints ?? []))
      .catch(() => setCheckpoints([]))
  }, [])

  useEffect(loadCheckpoints, [loadCheckpoints, stream.running])

  /* checkpoints arrive newest-first; user messages happen oldest-first — zip
     them so each rewind button sits on the run it undoes */
  const artifactCount = useMemo(() => countArtifacts(stream.blocks), [stream.blocks])

  const rewindTargets = useMemo(() => {
    const oldestFirst = [...checkpoints].reverse()
    const userIds: string[] = []
    for (const b of stream.blocks) if (b.k === 'user') userIds.push(b.id)
    const map: Record<string, string> = {}
    oldestFirst.forEach((cp, i) => {
      if (userIds[i]) map[userIds[i]] = cp.runId
    })
    return map
  }, [checkpoints, stream.blocks])

  const rewind = useCallback(
    async (runId: string) => {
      try {
        const r = await api.rewind(runId)
        setToast(`rewound — ${r.restored + r.removed} path(s) put back`)
        loadCheckpoints()
      } catch (err) {
        setToast(`could not rewind: ${(err as Error).message}`)
      }
    },
    [loadCheckpoints],
  )

  /* the price of the run, when the model's price is known — free models say
     so instead of pretending a dash means zero. Priced on the model that
     actually ran (auto/deep/fast choose per run), not the saved setting. */
  const cost = useMemo(() => {
    const usage = stream.usage
    if (!usage) return null
    const ranModel = usage.model ?? settings.model
    const priceText = remoteModels.find((m) => m.id === ranModel)?.promptPrice ?? ''
    const perM = Number.parseFloat(priceText.replace(/[^0-9.]/g, ''))
    if (!Number.isFinite(perM)) return null
    const cost = (usage.promptTokens + usage.completionTokens) / 1e6 * perM
    return cost < 0.01 ? '< $0.01' : `$${cost.toFixed(3)}`
  }, [stream.usage, remoteModels, settings.model])

  /* ---- toasts: the run speaks when you are not looking ------------------- */

  const [toast, setToast] = useState<string | null>(null)
  /** dims everything but the active block — a reading mode, not a theme */
  const [zen, setZen] = useState(false)

  /* the pointer light: one passive listener, one CSS variable, rAF-throttled */
  const pointerLightRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = pointerLightRef.current
    if (!el) return
    let raf = 0
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--mx', `${e.clientX}px`)
        el.style.setProperty('--my', `${e.clientY}px`)
      })
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => {
      window.removeEventListener('pointermove', move)
      cancelAnimationFrame(raf)
    }
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 4_500)
    return () => window.clearTimeout(t)
  }, [toast])

  /* the OS speaks only when the window is not looking at the reader */
  const notify = useCallback((title: string, body: string) => {
    const bridge = (
      window as unknown as {
        loong?: { notify?: (n: { title: string; body: string }) => void }
      }
    ).loong
    void bridge?.notify?.({ title, body })
  }, [])

  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !stream.running) {
      /* a successful end needs no toast: the run summary in the thread already
         says it, and a dark pill that appears and vanishes after every single
         message reads as a terminal flashing. Only a STOP is worth a word. */
      if (stream.error) setToast('the run stopped')
      if (document.hidden) {
        notify('Loong', stream.error ? 'the run stopped on an error' : 'the run finished')
      }
    }
    wasRunning.current = stream.running
  }, [stream.running, stream.error, notify])

  useEffect(() => {
    const last = stream.blocks[stream.blocks.length - 1]
    if (!last) return
    if (last.k === 'approval' && !last.decision) {
      setToast('a write needs your approval')
      if (document.hidden) notify('Loong needs you', 'a write needs your approval')
    } else if (last.k === 'question' && last.answer == null) {
      setToast('a question is waiting for you')
      if (document.hidden) notify('Loong needs you', 'a question is waiting for you')
    }
  }, [stream.blocks, notify])

  /* ---- the first run: who you are, and where the model comes from --------- */

  const finishWelcome = useCallback(
    (choice: { kind: 'local' | 'key'; name: string }) => {
      const name = choice.name.trim().slice(0, 40)
      if (name) set('userName', name)
      if (choice.kind === 'local') {
        /* the local model that actually calls tools — never the weak one */
        const first = models.find((m) => m.supportsTools)
        if (first) set('model', first.name)
        set('provider', 'ollama')
      } else {
        /* 6.3: a key path pre-selects a working model, so the reader is never
           asked to name one. The suggestion list is the provider's own. */
        set('provider', 'openrouter')
        const suggestion =
          remoteModels.find((m) => m.free)?.id ??
          remoteModels[0]?.id ??
          'nvidia/nemotron-3-super-120b-a12b:free'
        if (suggestion) set('model', suggestion)
        setSettingsOpen(true)
      }
      set('onboarded', true)
    },
    [models, remoteModels, set],
  )

  /* ---- one message back for editing -------------------------------------- */

  const [editSeed, setEditSeed] = useState<{ text: string; at: number } | null>(null)
  const editLastMessage = useCallback(() => {
    for (let i = stream.blocks.length - 1; i >= 0; i--) {
      const b = stream.blocks[i]
      if (b.k === 'user' && b.text.trim()) {
        setEditSeed({ text: b.text, at: Date.now() })
        return
      }
    }
  }, [stream.blocks])

  /* a selection in the thread becomes an input: the bar's four verbs land here.
     A giant selection is clamped — the composer is for a question, not a file. */
  const onSelectAction = useCallback((action: SelectionAction, text: string) => {
    const at = Date.now()
    const picked = text.length > 6000 ? `${text.slice(0, 6000)}\n…` : text
    if (action === 'copy') {
      void navigator.clipboard?.writeText(text)
      setToast('copied to clipboard')
    } else if (action === 'ask') {
      setMode('ask')
      setPrefill({ text: picked, at })
    } else if (action === 'explain') {
      setMode('ask')
      setPrefill({ text: `Explain this:\n\n${picked}`, at })
    } else {
      setPrefill({ text: `${picked}\n\n`, at })
    }
  }, [])

  const drawerSessions: Session[] = useMemo(
    () => sessions.map(toSession),
    [sessions],
  )

  /* the workbench reads both stores — a split's two threads and any background
     thread still streaming in the pane you are not looking at */
  const allAgents = useMemo(() => {
    const map = new Map<string, (typeof primary.agents)[number]>()
    for (const a of primary.agents) map.set(a.id, a)
    for (const a of secondary.agents) {
      const ex = map.get(a.id)
      map.set(a.id, ex && ex.running ? ex : a)
    }
    return [...map.values()]
  }, [primary.agents, secondary.agents])

  const mergedRunningIds = useMemo(
    () => Array.from(new Set([...primary.runningIds, ...secondary.runningIds])),
    [primary.runningIds, secondary.runningIds],
  )

  const activeTitle = useMemo(() => {
    const found = sessions.find((s) => s.id === focusedId)
    return found?.title ?? 'New thread'
  }, [sessions, focusedId])

  /* renaming from the header, the way every chat app does it */
  const titleInput = useRef<HTMLInputElement>(null)
  const titleCancelled = useRef(false)

  const startTitleEdit = useCallback(() => {
    setTitleDraft(activeTitle)
    titleCancelled.current = false
    setEditingTitle(true)
  }, [activeTitle])

  const commitTitle = useCallback(() => {
    if (titleCancelled.current) {
      titleCancelled.current = false
      setEditingTitle(false)
      return
    }
    setEditingTitle(false)
    const next = titleDraft.trim()
    if (next && next !== activeTitle) void renameActive(next)
  }, [titleDraft, activeTitle, renameActive])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (mod && e.key === ',') {
        e.preventDefault()
        setSettingsOpen((v) => !v)
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        drawer.setPinned(!drawer.pinned)
      } else if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void createThread()
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'r') {
        /* retry the last turn — a failed run should never need the pointer */
        e.preventDefault()
        void streamRef.current.retry(focusedId ?? undefined)
      } else if (e.key === 'Escape' && streamRef.current.running) {
        e.preventDefault()
        streamRef.current.stop()
      } else if (
        e.key === 'ArrowUp' &&
        !mod &&
        !streamRef.current.running &&
        !(document.activeElement instanceof HTMLTextAreaElement) &&
        !(document.activeElement instanceof HTMLInputElement)
      ) {
        /* ↑ on an idle thread brings the last message back for editing */
        e.preventDefault()
        editLastMessage()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer, createThread, focusedId, editLastMessage])

  const commands: Command[] = useMemo(
    () => [
      /* the model, switchable without leaving the keyboard — the palette is
         where "use a stronger model for this" becomes one keystroke. Picking a
         model by hand is a manual choice, so it sets the route with it. */
      ...models
        .filter((m) => m.name && m.supportsTools)
        .slice(0, 4)
        .map((m) => ({
          id: `model-${m.name}`,
          group: 'Model',
          label: m.name,
          hint: 'local',
          run: () => {
            set('model', m.name)
            set('route', 'manual')
          },
        })),
      ...remoteModels
        .filter((m) => m.free)
        .slice(0, 6)
        .map((m) => ({
          id: `model-${m.id}`,
          group: 'Model',
          label: m.id,
          hint: 'free',
          run: () => {
            set('provider', 'openrouter')
            set('model', m.id)
            set('route', 'manual')
          },
        })),
      /* the router, one keystroke away — the model commands above are all
         "manual" by definition, so they carry the route with them */
      {
        id: 'router-auto',
        group: 'Router',
        label: 'Auto — pick the model per message',
        run: () => set('route', 'auto'),
      },
      {
        id: 'router-fast',
        group: 'Router',
        label: 'Fast — the quickest model that can call tools',
        run: () => set('route', 'fast'),
      },
      {
        id: 'router-deep',
        group: 'Router',
        label: 'Deep — the strongest model that can call tools',
        run: () => set('route', 'deep'),
      },
      {
        id: 'router-manual',
        group: 'Router',
        label: 'Manual — always the chosen model',
        run: () => set('route', 'manual'),
      },
      {
        id: 'new',
        group: 'Thread',
        label: 'New thread',
        hint: '⌘N',
        run: () => void createThread(),
      },
      {
        id: 'stop',
        group: 'Thread',
        label: 'Stop the run',
        run: () => streamRef.current.stop(),
      },
      {
        id: 'retry',
        group: 'Thread',
        label: 'Retry the last message',
        run: () => void streamRef.current.retry(focusedId ?? undefined),
      },
      {
        id: 'delete-thread',
        group: 'Thread',
        label: 'Delete this thread…',
        run: () => {
          if (focusedId) setDeleteTarget(focusedId)
        },
      },
      {
        id: 'settings',
        group: 'Layout',
        label: 'Settings',
        hint: '⌘,',
        run: () => setSettingsOpen(true),
      },
      {
        id: 'pin',
        group: 'Layout',
        label: drawer.pinned ? 'Unpin saved threads' : 'Pin saved threads open',
        hint: '⌘B',
        run: () => drawer.setPinned(!drawer.pinned),
      },
      ...(splitId
        ? [
            {
              id: 'split-close',
              group: 'Layout',
              label: 'Close the split — back to one thread',
              run: () => closeSplit(),
            },
          ]
        : [
            {
              id: 'split-open',
              group: 'Layout',
              label: 'Open another thread to the right (split)',
              run: () => {
                const other = sessions.find((s) => s.id !== focusedId)
                if (other) {
                  void openSplit(other.id)
                  return
                }
                /* no second thread exists yet — make one and put it beside this */
                void (async () => {
                  try {
                    const { session } = await api.createSession({
                      provider: settings.provider,
                      model: settings.model,
                      workspace: workspace ?? undefined,
                    })
                    setSessions((prev) => [session, ...prev])
                    await openSplit(session.id)
                  } catch {
                    /* a new session needs the agent; without it there is no split */
                  }
                })()
              },
            },
          ]),
      {
        id: 'sound',
        group: 'Layout',
        label: settings.soundEnabled ? 'Turn sound off' : 'Turn sound on',
        run: toggleSound,
      },
      {
        id: 'theme',
        group: 'Layout',
        label:
          settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        run: () => set('theme', settings.theme === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'reset-layout',
        group: 'Layout',
        label: 'Reset every panel to its default width',
        run: () => {
          railSize.reset()
          measure.reset()
          drawerSize.reset()
          splitSize.reset()
        },
      },
    ],
    [
      drawer,
      settings.soundEnabled,
      settings.theme,
      set,
      toggleSound,
      createThread,
      deleteThread,
      focusedId,
      splitId,
      closeSplit,
      openSplit,
      sessions,
      settings.provider,
      settings.model,
      models,
      remoteModels,
      railSize,
      measure,
      drawerSize,
      splitSize,
    ],
  )

  /* the model that RAN, not the one saved in settings — on auto/deep/fast
     the router picks per run, and the old label could never be right there.
     A route switch must also be visible IMMEDIATELY: while a route is active
     the label says the route, never the last manual pick. */
  const onRoute = settings.route !== 'manual'
  const activeModel = onRoute ? stream.usage?.model ?? '' : settings.model
  const runtimeLabel = health
    ? `${provider.label} · ${onRoute ? `${settings.route} · ` : ''}${activeModel || (onRoute ? 'picks per run' : 'no model')}`
    : 'agent offline'

  /** the folder the agent is working in, shown under the thread title */
  const workspaceName = workspace
    ? workspace.split(/[\\/]/).filter(Boolean).pop() ?? workspace
    : '…'
  const modeLabel = mode === 'agent' ? 'agent' : mode === 'plan' ? 'plan' : 'ask'

  /* one pane. The composer, run bar and shortcuts target the focused pane's
     stream; clicking a pane moves the focus. The right pane carries its own
     slim header so it can be closed, and never holds the width grips. */
  const renderPane = (which: 'primary' | 'secondary') => {
    const s = which === 'primary' ? primary : secondary
    const isFocused = (splitFocus === 'secondary' ? 'secondary' : 'primary') === which
    const secTitle =
      which === 'secondary'
        ? (sessions.find((x) => x.id === splitId)?.title ?? 'Thread')
        : ''
    return (
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        onMouseDown={() => {
          if (!isFocused) setSplitFocus(which)
        }}
      >
        {splitId && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px"
            style={{ background: isFocused ? 'var(--line-4)' : 'transparent' }}
          />
        )}
        {which === 'secondary' && (
          <div
            className="flex h-[24px] shrink-0 items-center justify-between gap-[8px] px-[16px]"
            style={{ borderBottom: '1px solid var(--line-1)' }}
          >
            <span className="mono min-w-0 truncate text-[10.5px]" style={{ color: 'var(--text-4)' }}>
              {secTitle}
            </span>
            <button
              type="button"
              className="ctl rounded-[4px] px-[6px] py-[1px] text-[10px]"
              style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
              onClick={(e) => {
                e.stopPropagation()
                closeSplit()
              }}
              title="Close the split — back to one thread"
            >
              close
            </button>
          </div>
        )}
        <Thread
          blocks={s.blocks}
          phase={s.phase}
          running={s.running}
          onDecide={s.resolveApproval}
          onAnswer={s.answerQuestion}
          fontSize={settings.threadFontSize}
          onResizeStart={which === 'primary' ? measure.begin : () => {}}
          onResizeReset={which === 'primary' ? measure.reset : () => {}}
          resizing={which === 'primary' && measure.dragging}
          grips={which === 'primary'}
          pinTail={isFocused ? pinTail : 0}
          rewindTargets={s === stream ? rewindTargets : undefined}
          onRewind={rewind}
          onRewindRun={() => {
            const last = checkpoints[0]
            if (last) void rewind(last.runId)
          }}
          canRewindRun={checkpoints.length > 0}
          zen={zen}
        />
      </div>
    )
  }

  /* the first screen is the only one that is not the app — it asks the two
     questions a cold start actually has, then hands over to a real thread */
  if (!settings.onboarded) {
    return (
      <MotionConfig reducedMotion="user">
        <div className="h-full w-full" style={{ background: 'var(--canvas)' }}>
          <Noise />
          <Welcome onChoose={finishWelcome} localModels={models} />
        </div>
      </MotionConfig>
    )
  }

  return (
    <MotionConfig
      reducedMotion={
        settings.motion === 'reduced'
          ? 'always'
          : settings.motion === 'full'
            ? 'never'
            : 'user'
      }
    >
      <div
        className="flex h-full w-full overflow-hidden"
        style={
          {
            '--rail-w': `${railSize.size}px`,
            '--thread-measure': `${measure.size}px`,
            '--drawer-w': `${drawerSize.size}px`,
          } as React.CSSProperties
        }
      >
        <Noise />
        {/* the light follows the pointer — a 4% lift where the reader is
            looking, nothing else. One element, no listeners on children. */}
        <div
          ref={pointerLightRef}
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[1]"
          style={{
            background:
              'radial-gradient(520px circle at var(--mx, 50%) var(--my, 30%), rgba(255,255,255,0.035), transparent 62%)',
          }}
        />

        <Rail
          soundOn={settings.soundEnabled}
          onToggleSound={toggleSound}
          theme={settings.theme}
          onToggleTheme={() =>
            set('theme', settings.theme === 'dark' ? 'light' : 'dark')
          }
          drawerPinned={drawer.pinned}
          onTogglePin={() => drawer.setPinned(!drawer.pinned)}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onNewThread={() => void createThread()}
          onPeekDrawer={drawer.peek}
        />

        <Resizer
          onPointerDown={railSize.begin}
          onReset={railSize.reset}
          dragging={railSize.dragging}
          label="Rail width"
        />

        <main className="relative flex min-w-0 flex-1 flex-col">
          <header
            className="flex h-[42px] shrink-0 items-center justify-between px-[24px]"
            style={{ borderBottom: '1px solid var(--line-1)' }}
          >
            <div className="flex min-w-0 items-baseline gap-[10px]">
              {editingTitle ? (
                <input
                  ref={titleInput}
                  autoFocus
                  value={titleDraft}
                  maxLength={120}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      e.currentTarget.blur()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      titleCancelled.current = true
                      e.currentTarget.blur()
                    }
                  }}
                  onBlur={commitTitle}
                  className="display rounded-[4px] px-[4px] py-[1px] text-[13.5px] outline-none"
                  style={{
                    width: 240,
                    color: 'var(--text-1)',
                    background: 'var(--surface-sunken)',
                    border: '1px solid var(--line-4)',
                  }}
                />
              ) : (
                <h1
                  role="button"
                  tabIndex={0}
                  onClick={startTitleEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      startTitleEdit()
                    }
                  }}
                  className="display min-w-0 cursor-text truncate rounded-[4px] px-[3px] py-[1px] text-[13.5px] outline-none"
                  style={{ color: 'var(--text-1)' }}
                  title="Click to rename this thread"
                >
                  {activeTitle}
                </h1>
              )}
              <span
                className="mono shrink-0 text-[10.5px]"
                style={{ color: 'var(--text-4)' }}
              >
                {loadingThread ? 'loading…' : `${stream.blocks.length} blocks`}
              </span>
              {/* what the agent is actually working on, always visible. A
                  workspace you cannot see is a workspace you cannot trust. */}
              <button
                type="button"
                className="ctl flex shrink-0 items-center gap-[5px] rounded-[5px] px-[6px] py-[2px]"
                style={{
                  border: '1px solid var(--line-2)',
                  color: 'var(--text-3)',
                  background: 'var(--surface)',
                }}
                onClick={() => void changeWorkspace()}
                title={`${workspace ?? '…'} — click to change`}
              >
                <IconFolder size={11} />
                <span className="mono max-w-[180px] truncate text-[10.5px]">
                  {workspaceName}
                </span>
              </button>
            </div>
        <div className="flex shrink-0 items-center gap-[12px]">
          <span
            className="mono shrink-0 text-[10.5px]"
            style={{ color: 'var(--text-4)' }}
            title="The mode the agent is running in"
          >
            {modeLabel}
          </span>
          {/* what the last run actually cost at the provider, when it tells us */}
          {stream.usage && (
            <span
              className="mono hidden shrink-0 text-[10.5px] lg:inline"
              style={{ color: 'var(--text-4)' }}
              title={`The provider's accounting for the last run: ${stream.usage.promptTokens.toLocaleString()} in, ${stream.usage.completionTokens.toLocaleString()} out`}
            >
              {(stream.usage.promptTokens / 1000).toFixed(1)}k in ·{' '}
              {(stream.usage.completionTokens / 1000).toFixed(1)}k out
            </span>
          )}
              <motion.span
                className="mono hidden shrink-0 text-[10.5px] md:inline"
                style={{ color: health ? 'var(--text-4)' : 'var(--text-2)' }}
                animate={{ opacity: drawer.open ? 0 : 1 }}
                transition={{ duration: dur.enter, ease: easeOut }}
              >
                {runtimeLabel}
              </motion.span>
            </div>
          </header>

          {/* the toast: a run that finishes, or a human the run needs, says so
              even when the reader is looking elsewhere */}
          <AnimatePresence>
            {toast && (
              <motion.div
                key={toast}
                className="mono absolute top-[52px] left-1/2 z-[60] -translate-x-1/2 rounded-[7px] px-[12px] py-[6px] text-[11px]"
                style={{
                  border: '1px solid var(--line-4)',
                  background: 'var(--canvas)',
                  color: 'var(--text-2)',
                }}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: dur.enter, ease: easeOut }}
              >
                {toast}
              </motion.div>
            )}
          </AnimatePresence>

          {/* the run, spoken — the interface was silent to a screen reader */}
          <RunStatus running={stream.running} blocks={stream.blocks} error={stream.error} />

          {(goal || stream.running) && (
            <div className="px-[24px] pt-[8px]">
              <RunBar
                goal={goal}
                plan={currentPlan}
                running={stream.running}
                startedAt={runStartedAt}
                historyChars={historyChars}
                budgetChars={HISTORY_BUDGET}
                cost={cost}
                onRewind={() => {
                  const last = checkpoints[0]
                  if (last) void rewind(last.runId)
                }}
                canRewind={checkpoints.length > 0}
                trust={settings.trust}
              />
            </div>
          )}

          {/* the instruments: shape of the run, a scrubber, presence, zen */}
          <StudioStrip
            blocks={stream.blocks}
            phase={stream.phase}
            running={stream.running}
            zen={zen}
            onZen={() => setZen((z) => !z)}
          />

          <div ref={transcriptRef} className="relative flex min-h-0 flex-1">
            {splitId ? (
              <>
                <div className="flex min-w-0 flex-1 flex-col">{renderPane('primary')}</div>
                <Resizer
                  onPointerDown={splitSize.begin}
                  onReset={splitSize.reset}
                  dragging={splitSize.dragging}
                  label="Split width"
                />
                <div className="flex min-w-0 flex-col" style={{ width: splitSize.size }}>
                  {renderPane('secondary')}
                </div>
              </>
            ) : (
              <div className="flex min-w-0 flex-1 flex-col">{renderPane('primary')}</div>
            )}
          </div>
          <SelectionBar container={transcriptRef} onPick={onSelectAction} />

          {stream.error && (
            <div className="px-[24px]">
              <p
                className="mono mx-auto m-0 text-[11px]"
                style={{ maxWidth: 'var(--thread-measure)', color: 'var(--text-2)' }}
              >
                {stream.error}
              </p>
            </div>
          )}

          <Composer
            phase={stream.phase}
            running={stream.running}
            onSend={sendMessage}
            onStop={stream.stop}
            mode={mode}
            onModeChange={setMode}
            trust={settings.trust}
            modelVision={
              settings.provider === 'openrouter'
                ? (remoteModels.find((m) => m.id === settings.model)?.vision ?? null)
                : null
            }
            onToggleTrust={() =>
              set('trust', settings.trust === 'ask' ? 'auto' : 'ask')
            }
            queued={queued}
            onCancelQueue={() => setQueued(null)}
            editSeed={editSeed}
            prefill={prefill}
            suggestions={suggestions}
          />

          <AnimatePresence>
            {drawer.open && (
              <motion.div
                key="drawer-grip"
                className="absolute top-0 bottom-0 z-[55]"
                style={{ right: 'var(--drawer-w)' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: dur.enter, ease: easeOut }}
              >
                <Resizer
                  onPointerDown={drawerSize.begin}
                  onReset={drawerSize.reset}
                  dragging={drawerSize.dragging}
                  label="Saved threads width"
                />
              </motion.div>
            )}
          </AnimatePresence>

          <ThreadDrawer
            open={drawer.open}
            pinned={drawer.pinned}
            onTogglePin={() => drawer.setPinned(!drawer.pinned)}
            sessions={drawerSessions}
            activeId={activeId ?? ''}
            onSelect={(s) => {
              sound.play('select')
              void openThread(s.id)
            }}
            onRename={renameThread}
            onDelete={(id) => setDeleteTarget(id)}
            runningIds={mergedRunningIds}
            artifacts={<ArtifactsPanel blocks={stream.blocks} />}
            artifactCount={artifactCount}
            agents={
              <AgentsPanel
                agents={allAgents}
                activeId={activeId ?? ''}
                onOpen={(id) => {
                  sound.play('select')
                  if (id === splitId) setSplitFocus('secondary')
                  else void openThread(id)
                }}
                onStop={(id) => {
                  if (id === splitId) secondary.stop(id)
                  else primary.stop(id)
                }}
              />
            }
            agentCount={allAgents.length}
            review={<ReviewPanel />}
          />

          <AnimatePresence>
            {drawer.hot && !drawer.open && (
              <motion.div
                key="grip"
                className="absolute top-1/2 right-0 z-50 -translate-y-1/2 rounded-l-full"
                style={{ width: 2, height: 76, background: 'var(--line-5)' }}
                initial={{ opacity: 0, scaleY: 0.4 }}
                animate={{ opacity: 1, scaleY: 1 }}
                exit={{ opacity: 0, scaleY: 0.4 }}
                transition={{ duration: dur.enter, ease: easeOut }}
              />
            )}
          </AnimatePresence>

          <ConfirmDialog
            open={deleteTarget != null}
            title="Delete this thread?"
            body="This removes the conversation for good — it cannot be undone. Files the agent already wrote stay where they are."
            confirmLabel="Delete"
            onCancel={() => setDeleteTarget(null)}
            onConfirm={() => {
              const id = deleteTarget
              setDeleteTarget(null)
              if (id) void deleteThread(id)
            }}
          />

          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            commands={commands}
            threads={drawerSessions}
            onOpenThread={(id) => void openThread(id)}
          />

          <Settings
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            health={health}
            models={models}
            remoteModels={remoteModels}
          />
        </main>
      </div>
    </MotionConfig>
  )
}
