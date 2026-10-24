import { useState } from 'react'

/* ---------------------------------------------------------------------------
   A project is a name and a folder — asked for, not guessed.

   Picking a folder and naming the project after it means every project is
   called `my-app` or `first-game`, which is the folder's problem, not the
   project's. This asks for both, in that order, and only then creates.
   --------------------------------------------------------------------------- */

export function NewProjectDialog({
  onCancel,
  onPickFolder,
  onCreate,
}: {
  onCancel: () => void
  /** opens the OS folder picker; resolves to the chosen path, or null */
  onPickFolder: () => Promise<string | null>
  /** the folder is chosen and the name typed — create it */
  onCreate: (name: string, folder: string) => void
}) {
  const [name, setName] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const pick = async () => {
    setBusy(true)
    try {
      const chosen = await onPickFolder()
      if (chosen) {
        setFolder(chosen)
        /* a name is not a path: offer the folder's leaf as a starting point,
           but let it be edited — that is the whole point */
        if (!name.trim()) setName(chosen.split(/[\\/]/).filter(Boolean).pop() ?? '')
      }
    } finally {
      setBusy(false)
    }
  }

  const ready = name.trim().length > 0 && folder !== null

  return (
    <div
      className="absolute inset-0 z-[70] grid place-items-center"
      style={{ background: 'var(--scrim)', backdropFilter: 'blur(2px)' }}
      onMouseDown={onCancel}
    >
      <div
        className="w-[420px] rounded-[14px] p-[20px]"
        style={{ background: 'var(--canvas)', border: '1px solid var(--line-4)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="display m-0 text-[15px]" style={{ color: 'var(--text-1)' }}>
          New project
        </h2>
        <p className="mt-[4px] mb-[16px] text-[12px] leading-[1.6]" style={{ color: 'var(--text-3)' }}>
          A name you will recognise, and the folder the agent works in.
        </p>

        <label className="mono mb-[4px] block text-[10px] tracking-[0.12em] uppercase" style={{ color: 'var(--text-4)' }}>
          Name
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ready) onCreate(name.trim(), folder!)
            if (e.key === 'Escape') onCancel()
          }}
          placeholder="Pizza Dimension"
          className="w-full rounded-[8px] px-[11px] py-[8px] text-[13px] outline-none"
          style={{ border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--text-1)' }}
        />

        <label className="mono mt-[14px] mb-[4px] block text-[10px] tracking-[0.12em] uppercase" style={{ color: 'var(--text-4)' }}>
          Folder
        </label>
        <button
          type="button"
          onClick={() => void pick()}
          disabled={busy}
          className="ctl w-full rounded-[8px] px-[11px] py-[8px] text-left text-[12.5px]"
          style={{
            border: '1px solid var(--line-2)',
            background: 'var(--surface)',
            color: folder ? 'var(--text-1)' : 'var(--text-3)',
          }}
        >
          {busy ? 'choosing…' : (folder ?? 'Choose a folder…')}
        </button>

        <div className="mt-[18px] flex items-center justify-end gap-[8px]">
          <button
            type="button"
            onClick={onCancel}
            className="ctl rounded-[7px] px-[11px] py-[6px] text-[12px]"
            style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => ready && onCreate(name.trim(), folder!)}
            className="ctl rounded-[7px] px-[13px] py-[6px] text-[12px]"
            style={{
              border: '1px solid var(--line-4)',
              background: ready ? 'var(--surface-raised)' : 'transparent',
              color: ready ? 'var(--text-1)' : 'var(--text-4)',
              opacity: ready ? 1 : 0.6,
            }}
          >
            Create project
          </button>
        </div>
      </div>
    </div>
  )
}
