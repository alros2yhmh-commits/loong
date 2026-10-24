import { motion } from 'motion/react'
import { useState } from 'react'
import { Guilloche } from './Guilloche'
import { dur, easeOut, spring } from '../motion/tokens'
import { sound } from '../lib/sound'

/* ---------------------------------------------------------------------------
   The first screen, and the only one that is not the app.

   A cold start has exactly two questions: who are you, and where does the
   model come from. Everything else — the workspace, the modes, the trust
   switch — is discoverable from a thread that already exists. So this screen
   asks those two and gets out of the way.

   6.3 lives here too: picking a key path pre-selects a working model from the
   provider's own suggestions, so the reader is never asked to name one. A
   model id is a implementation detail, not a first-run question.
   --------------------------------------------------------------------------- */

export interface WelcomeChoice {
  kind: 'local' | 'key'
  name: string
}

export function Welcome({
  onChoose,
  localModels,
}: {
  onChoose: (choice: WelcomeChoice) => void
  /** models already on this machine, when the agent answered */
  localModels: { name: string; supportsTools: boolean }[]
}) {
  const [name, setName] = useState('')
  const toolCapable = localModels.filter((m) => m.supportsTools)

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden">
      <div
        className="absolute inset-x-0 top-0 h-[280px] opacity-70"
        style={{ color: 'var(--guilloche)' }}
      >
        <Guilloche width={1512} height={280} lines={22} period={88} amplitude={8} spread={2.8} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring.settle}
        className="relative w-full max-w-[520px] px-[24px]"
      >
        <h1 className="display m-0 text-[26px] leading-[1.2]">Loong</h1>
        <p className="mt-[10px] text-[13.5px] leading-[1.7]" style={{ color: 'var(--text-3)' }}>
          A desktop agent. It reads your code, writes, runs commands and proves
          its work with evidence — on this machine, with the model you choose.
        </p>

        <div
          className="mt-[26px] rounded-[10px] px-[16px] py-[14px]"
          style={{ border: '1px solid var(--line-2)', background: 'var(--surface)' }}
        >
          <label
            className="mono m-0 block text-[10px] tracking-[0.08em] uppercase"
            style={{ color: 'var(--text-4)' }}
            htmlFor="welcome-name"
          >
            what should Loong call you
          </label>
          <input
            id="welcome-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                sound.play('select')
                onChoose({ kind: 'local', name })
              }
            }}
            placeholder="your name — optional"
            maxLength={40}
            className="mt-[8px] block w-full bg-transparent text-[14px] outline-none"
            style={{ color: 'var(--text-1)' }}
          />
        </div>

        <div className="mt-[12px] flex flex-col gap-[8px]">
          <button
            type="button"
            className="ctl flex items-center justify-between rounded-[9px] px-[15px] py-[12px] text-left"
            style={{ border: '1px solid var(--line-3)', background: 'var(--surface)' }}
            onClick={() => {
              sound.play('select')
              onChoose({ kind: 'local', name })
            }}
          >
            <span>
              <span className="block text-[13px]" style={{ color: 'var(--text-1)' }}>
                Use a local model
              </span>
              <span className="mono mt-[3px] block text-[10.5px]" style={{ color: 'var(--text-4)' }}>
                {toolCapable.length > 0
                  ? `ollama · ${toolCapable.length} model${toolCapable.length === 1 ? '' : 's'} ready · no key, no network`
                  : 'ollama · no key, no network — install a model to start'}
              </span>
            </span>
            <span className="mono text-[11px]" style={{ color: 'var(--text-3)' }}>
            </span>
          </button>

          <button
            type="button"
            className="ctl flex items-center justify-between rounded-[9px] px-[15px] py-[12px] text-left"
            style={{ border: '1px solid var(--line-2)' }}
            onClick={() => {
              sound.play('select')
              onChoose({ kind: 'key', name })
            }}
          >
            <span>
              <span className="block text-[13px]" style={{ color: 'var(--text-2)' }}>
                Add an API key
              </span>
              <span className="mono mt-[3px] block text-[10.5px]" style={{ color: 'var(--text-4)' }}>
                openrouter · anthropic · openai · google — stored in the system keychain
              </span>
            </span>
            <span className="mono text-[11px]" style={{ color: 'var(--text-3)' }}>
            </span>
          </button>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: dur.enter, ease: easeOut, delay: 0.25 }}
          className="mono m-0 mt-[18px] text-[10.5px] leading-[1.7]"
          style={{ color: 'var(--text-4)' }}
        >
          ⌘K commands · ⌘, settings · right edge for saved threads
        </motion.p>
      </motion.div>
    </div>
  )
}
