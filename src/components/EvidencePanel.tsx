import { useEffect, useMemo, useRef, useState } from 'react'
import type { Block } from '../lib/blocks'
import { api, type RewindResult } from '../lib/api'
import { checkEvidence, taskBlocks, terminalEvidence } from '../lib/evidence'
import { DiffPane } from './DiffPane'

export type EvidenceTab = 'changes' | 'checks' | 'terminal' | 'artifacts'

function panelWidth(): number {
  try { return Math.max(300, Math.min(640, Number(localStorage.getItem('loong.evidence.width')) || 380)) }
  catch { return 380 }
}

export function EvidencePanel({ tab, onTab, onClose, blocks, workspace, running, onCount, runId, runWorkspace, onRewound }: {
  tab: EvidenceTab
  onTab: (tab: EvidenceTab) => void
  onClose: () => void
  blocks: Block[]
  workspace: string | null
  running: boolean
  onCount?: (count: number) => void
  runId?: string | null
  runWorkspace?: string | null
  onRewound?: () => void
}) {
  const [width, setWidth] = useState(panelWidth)
  const [confirmUndo, setConfirmUndo] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [undoResult, setUndoResult] = useState<RewindResult | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const scope = `${runId ?? ''}:${workspace ?? ''}`
  const currentScope = useRef(scope)
  currentScope.current = scope
  useEffect(() => { setConfirmUndo(false); setUndoResult(null); setUndoError(null); setUndoing(false) }, [scope])
  const canUndo = Boolean(runId && workspace && runWorkspace === workspace && !running)
  const didUndo = Boolean(undoResult && (undoResult.restored > 0 || undoResult.removed > 0))
  const undo = async () => {
    if (!canUndo || !runId || undoing) return
    const requestedScope = scope
    setUndoing(true)
    setUndoError(null)
    try {
      const result = await api.rewind(runId)
      onRewound?.()
      if (currentScope.current !== requestedScope) return
      setUndoResult(result)
      setConfirmUndo(false)
      setRevision((value) => value + 1)
    } catch (error) {
      if (currentScope.current === requestedScope) setUndoError(error instanceof Error ? error.message : 'The undo was not confirmed. Review files before retrying.')
    } finally { if (currentScope.current === requestedScope) setUndoing(false) }
  }

  const drag = useRef<{ x: number; width: number; direction: number } | null>(null)
  const checks = useMemo(() => checkEvidence(blocks), [blocks])
  const commands = useMemo(() => terminalEvidence(blocks), [blocks])
  const shots = useMemo(() => taskBlocks(blocks).filter(
    (block): block is Extract<Block, { k: 'screenshot' }> => block.k === 'screenshot',
  ), [blocks])
  const saveWidth = (next: number) => {
    const clamped = Math.max(300, Math.min(640, next))
    setWidth(clamped)
    try { localStorage.setItem('loong.evidence.width', String(clamped)) } catch { /* local preference only */ }
  }

  return (
    <aside id="task-evidence-panel" className="evidence-panel" style={{ width }} aria-label="Task evidence">
      <div
        className="evidence-resize" role="separator" aria-orientation="vertical"
        aria-label="Resize evidence panel" aria-valuemin={300} aria-valuemax={640} aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, width, direction: event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl' ? -1 : 1 }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (drag.current) saveWidth(drag.current.width + (drag.current.x - event.clientX) * drag.current.direction)
        }}
        onPointerUp={() => { drag.current = null }}
        onLostPointerCapture={() => { drag.current = null }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            const direction = event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl' ? -1 : 1
            saveWidth(width + (event.key === 'ArrowLeft' ? 20 : -20) * direction)
          }
        }}
      />
      <header className="flex shrink-0 items-center gap-[8px] px-[14px] py-[12px]" style={{ borderBottom: '1px solid var(--line-1)' }}>
        <h2 className="t-h3 flex-1">Task evidence</h2>
        <button type="button" className="ctl rounded-[6px] px-[7px] py-[3px] t-small" aria-label="Close evidence panel" onClick={onClose}>×</button>
      </header>
      <div className="flex shrink-0 gap-[3px] overflow-x-auto px-[9px] py-[7px]" role="tablist" aria-label="Evidence views" style={{ borderBottom: '1px solid var(--line-1)' }}>
        {(['changes', 'checks', 'terminal', 'artifacts'] as EvidenceTab[]).map((name) => (
          <button key={name} id={`evidence-tab-${name}`} type="button" role="tab" aria-selected={tab === name}
            aria-controls={`evidence-${name}`} tabIndex={tab === name ? 0 : -1}
            className="ctl rounded-[6px] px-[8px] py-[5px] t-tiny"
            style={{ background: tab === name ? 'var(--selected)' : 'transparent', color: tab === name ? 'var(--text-1)' : 'var(--text-3)' }}
            onClick={() => onTab(name)}
            onKeyDown={(event) => {
              const names: EvidenceTab[] = ['changes', 'checks', 'terminal', 'artifacts']
              const index = names.indexOf(name)
              const next = event.key === 'ArrowRight' ? names[(index + 1) % names.length]
                : event.key === 'ArrowLeft' ? names[(index + names.length - 1) % names.length]
                  : event.key === 'Home' ? names[0] : event.key === 'End' ? names[names.length - 1] : null
              if (next) { event.preventDefault(); onTab(next); document.getElementById(`evidence-tab-${next}`)?.focus() }
            }}>
            {name[0].toUpperCase() + name.slice(1)}{name === 'checks' && checks.length > 0 ? ` (${checks.length})` : ''}
          </button>
        ))}
      </div>
      <section id={`evidence-${tab}`} role="tabpanel" aria-labelledby={`evidence-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'changes' && <div className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 border-b px-[14px] py-[10px]" style={{ borderColor: 'var(--line-1)' }}>
            <button type="button" disabled={!canUndo || undoing || didUndo}
              className="ctl rounded-[6px] px-[9px] py-[5px] t-tiny disabled:opacity-40"
              style={{ border: '1px solid var(--line-3)', color: 'var(--text-2)' }}
              onClick={() => setConfirmUndo(true)}>
              {undoing ? 'Undoing…' : didUndo ? 'Undo recorded' : 'Undo this run'}
            </button>
            {!canUndo && <p className="m-0 mt-[5px] t-tiny" style={{ color: 'var(--text-3)' }}>
              {running ? 'Wait for this task to settle before undoing its changes.' : 'Undo is available for a saved run in this exact project folder.'}
            </p>}
            {confirmUndo && canUndo && <div role="group" aria-label="Confirm undo this run" className="mt-[8px]">
              <p className="m-0 t-small leading-[1.6]" style={{ color: 'var(--text-2)' }}>Undo the file changes recorded by this run? Later edits are preserved as conflicts. Commands and external actions cannot be undone here.</p>
              <div className="mt-[8px] flex gap-[7px]">
                <button type="button" disabled={undoing} onClick={() => void undo()} className="ctl rounded-[6px] px-[9px] py-[5px] t-small" style={{ border: '1px solid var(--amber-line)', color: 'var(--amber)' }}>Confirm undo</button>
                <button type="button" disabled={undoing} onClick={() => setConfirmUndo(false)} className="ctl rounded-[6px] px-[9px] py-[5px] t-small" style={{ border: '1px solid var(--line-2)' }}>Keep changes</button>
              </div>
            </div>}
            {undoError && <p role="alert" className="m-0 mt-[7px] t-small" style={{ color: 'var(--fail)' }}>{undoError}</p>}
            {undoResult && <div role="status" className="mt-[7px] t-small" style={{ color: undoResult.conflicts.length || undoResult.failed.length ? 'var(--amber)' : 'var(--text-2)' }}>
              <p className="m-0">{undoResult.conflicts.length || undoResult.failed.length ? 'Undo was incomplete. ' : ''}{undoResult.restored} restored · {undoResult.removed} removed.</p>
              {didUndo && <p className="m-0 mt-[4px] t-tiny">Previous checks and completion describe the earlier file revision. Verify again before continuing.</p>}
              {(undoResult.conflicts.length > 0 || undoResult.failed.length > 0) && <details className="mt-[5px]">
                <summary className="ctl t-tiny">Review preserved conflicts and failures</summary>
                <ul className="m-0 mt-[5px] ps-[18px] t-tiny">
                  {undoResult.conflicts.map((conflict) => <li key={conflict.path}><bdi dir="ltr" className="mono">{conflict.path}</bdi>: {conflict.reason}</li>)}
                  {undoResult.failed.map((path) => <li key={path}><bdi dir="ltr" className="mono">{path}</bdi>: could not restore this path.</li>)}
                </ul>
              </details>}
            </div>}
          </div>
          <div className="min-h-0 flex-1"><DiffPane embedded workspace={workspace} onClose={onClose} onCount={onCount} refreshKey={blocks.filter((block) => block.k === 'tool' && !block.live).length + revision} /></div>
        </div>}
        {tab === 'checks' && (
          <div className="flex flex-col gap-[10px] p-[14px]">
            <p className="m-0 t-tiny" style={{ color: 'var(--text-3)' }}>Checks for the latest request. A check becomes outdated when a later tool changes files.</p>
            {checks.length === 0 && <Empty>{running ? 'No verification result yet. Work may still be running.' : 'No verification result recorded. This does not establish that the code works.'}</Empty>}
            {checks.map((check) => (
              <article key={check.id} className="rounded-[8px] p-[11px]" style={{ border: '1px solid var(--line-2)', background: 'var(--raised)' }}>
                <div className="flex items-center gap-[7px] t-small">
                  <strong style={{ color: check.stale ? 'var(--amber)' : check.ok ? 'var(--ok)' : 'var(--fail)' }}>{check.stale ? 'Outdated' : check.ok ? 'Passed' : 'Failed'}</strong>
                  <time className="ms-auto t-tiny" dateTime={new Date(check.at).toISOString()}>{new Date(check.at).toLocaleTimeString()}</time>
                </div>
                <p dir="auto" className="m-0 mt-[5px] t-small">{check.label}</p>
                {(typeof check.exitCode === 'number' || typeof check.seconds === 'number') && <p className="m-0 mt-[5px] t-tiny" style={{ color: 'var(--text-3)' }}>
                  {typeof check.exitCode === 'number' ? `Exit code ${check.exitCode}` : ''}
                  {typeof check.exitCode === 'number' && typeof check.seconds === 'number' ? ' · ' : ''}
                  {typeof check.seconds === 'number' ? `${check.seconds.toFixed(1)}s` : ''}
                </p>}
                {check.command && <pre dir="ltr" className="evidence-code mt-[8px]" aria-label="Verification command">{check.command}</pre>}
                {check.output && <details className="mt-[8px]" open={!check.ok}>
                  <summary className="ctl t-tiny">Verification output</summary>
                  <pre dir="ltr" className="evidence-code mt-[5px]" tabIndex={0}>{check.output}</pre>
                </details>}
                {check.stale && <p className="m-0 mt-[5px] t-tiny" style={{ color: 'var(--text-3)' }}>Files changed after this check; verify the current version again.</p>}
              </article>
            ))}
          </div>
        )}
        {tab === 'terminal' && <div className="flex flex-col gap-[12px] p-[14px]">
          {commands.length === 0 && <Empty>No command output for this request yet. Ask Loong to run or verify the project.</Empty>}
          {commands.map((command) => <article key={command.id}>
            <div className="mb-[5px] flex items-center gap-[8px] t-tiny">
              <strong>{command.tool}</strong><span style={{ color: command.live ? 'var(--amber)' : command.ok === false ? 'var(--fail)' : 'var(--text-3)' }}>{command.live ? 'Running' : command.ok === false ? 'Failed' : 'Finished'}</span>
              {typeof command.ms === 'number' && <span className="ms-auto">{(command.ms / 1000).toFixed(1)}s</span>}
            </div>
            {command.args && <details><summary className="ctl t-tiny mb-[4px]">Command details</summary><pre dir="ltr" className="evidence-code">{command.args}</pre></details>}
            <pre dir="ltr" className="evidence-code" tabIndex={0}>{command.result || (command.live ? 'Waiting for output…' : 'No output recorded.')}</pre>
          </article>)}
        </div>}
        {tab === 'artifacts' && <div className="flex flex-col gap-[14px] p-[14px]">
          {shots.length === 0 && <Empty>No screenshots for this request yet.</Empty>}
          {shots.map((shot) => <figure className="m-0" key={shot.id}>
            <img src={api.shotUrl(shot.path.split(/[\\/]/).pop() ?? shot.path)} alt={`Screenshot from ${shot.tool}`} className="w-full rounded-[8px]" loading="lazy" />
            <figcaption className="mt-[5px] t-tiny" style={{ color: 'var(--text-3)' }}>{shot.tool} · {new Date(shot.at).toLocaleTimeString()}</figcaption>
          </figure>)}
        </div>}
      </section>
    </aside>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="m-0 rounded-[9px] p-[13px] t-small leading-[1.65]" style={{ color: 'var(--text-3)', border: '1px dashed var(--line-2)' }}>{children}</p>
}
