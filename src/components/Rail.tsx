import { motion } from 'motion/react'
import { useState } from 'react'
import { dur, spring } from '../motion/tokens'
import { sound } from '../lib/sound'
import {
  IconMoon,
  IconPanelRight,
  IconPin,
  IconPlus,
  IconSearch,
  IconSliders,
  IconSoundOff,
  IconSoundOn,
  IconSun,
} from './Icons'

/* ---------------------------------------------------------------------------
   The rail.

   Four controls that are about the application, not about the thread: new,
   find, pin the drawer, settings. Everything else lives in the command palette.
   The icon at the top is the same engraving as the app icon, at 26px.
   --------------------------------------------------------------------------- */

interface RailProps {
  soundOn: boolean
  onToggleSound: () => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  drawerPinned: boolean
  onTogglePin: () => void
  onOpenPalette: () => void
  onOpenSettings: () => void
  onNewThread: () => void
  onPeekDrawer: () => void
}

function RailButton({
  label,
  onClick,
  children,
  active,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  active?: boolean
}) {
  /* hover lives in state, never as a direct style mutation. The stream
     re-renders this tree roughly every 40ms, and React would wipe any inline
     style written straight onto the node. */
  const [hover, setHover] = useState(false)

  return (
    <motion.button
      type="button"
      className="ctl group relative grid h-[34px] w-[34px] place-items-center rounded-[7px]"
      style={{
        color: active || hover ? 'var(--text-1)' : 'var(--text-3)',
        border: `1px solid ${
          hover ? 'var(--line-2)' : active ? 'var(--line-1)' : 'transparent'
        }`,
        background: hover
          ? 'var(--surface)'
          : active
            ? 'var(--surface-sunken)'
            : 'transparent',
      }}
      onClick={() => {
        sound.play('click')
        onClick()
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      /* No idle animation. A control that pulses on its own to be noticed is
         noise the reader did not ask for, and it competes with the thread. */
      whileTap={{ scale: 0.94 }}
      transition={spring.snap}
      title={label}
      aria-label={label}
    >
      {children}
      <span
        className="pointer-events-none absolute left-[42px] z-50 whitespace-nowrap rounded-[6px] px-2 py-[3px] text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--line-2)',
          color: 'var(--text-2)',
          transitionDuration: `${dur.hover * 1000}ms`,
        }}
      >
        {label}
      </span>
    </motion.button>
  )
}

export function Rail({
  soundOn,
  onToggleSound,
  theme,
  onToggleTheme,
  drawerPinned,
  onTogglePin,
  onOpenPalette,
  onOpenSettings,
  onNewThread,
  onPeekDrawer,
}: RailProps) {
  return (
    <div
      className="relative z-30 flex h-full shrink-0 flex-col items-center"
      style={{
        width: 'var(--rail-w)',
        borderRight: '1px solid var(--line-2)',
        background: 'var(--canvas)',
      }}
    >
      <motion.div
        className="mt-[14px] mb-[18px] overflow-hidden rounded-[7px]"
        style={{ width: 26, height: 26 }}
        initial={{ opacity: 0, scale: 0.86 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...spring.settle, delay: 0.05 }}
      >
        <img
          src="./icon/icon-128.png"
          alt="Loong"
          width={26}
          height={26}
          draggable={false}
        />
      </motion.div>

      <div className="flex flex-col items-center gap-[6px]">
        <RailButton label="New thread" onClick={onNewThread}>
          <IconPlus />
        </RailButton>
        <RailButton label="Commands  ⌘K" onClick={onOpenPalette}>
          <IconSearch />
        </RailButton>
        <RailButton
          label={drawerPinned ? 'Saved threads: pinned' : 'Pin saved threads'}
          onClick={onTogglePin}
          active={drawerPinned}
        >
          <IconPin />
        </RailButton>
      </div>

      <div className="flex-1" />

      <div className="mb-[14px] flex flex-col items-center gap-[6px]">
        <RailButton
          label={soundOn ? 'Sound on' : 'Sound off — click to enable'}
          onClick={onToggleSound}
          active={soundOn}
        >
          {soundOn ? <IconSoundOn /> : <IconSoundOff />}
        </RailButton>
        <RailButton
          label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? <IconMoon /> : <IconSun />}
        </RailButton>
        <RailButton label="Settings  ⌘," onClick={onOpenSettings}>
          <IconSliders />
        </RailButton>
        {/* this used to be a decorative icon that did nothing, which is worse
            than having no button at all. It now peeks the drawer open. */}
        <RailButton
          label="Peek at saved threads"
          onClick={onPeekDrawer}
        >
          <IconPanelRight />
        </RailButton>
      </div>
    </div>
  )
}
