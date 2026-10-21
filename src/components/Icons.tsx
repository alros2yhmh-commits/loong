/* ---------------------------------------------------------------------------
   Icons — hairline only.

   Every glyph is a single 1px stroke on a 16px grid with no fill, so it reads
   as engraved rather than drawn. No icon font, no sprite sheet, no dependency.
   --------------------------------------------------------------------------- */

interface IconProps {
  size?: number
  className?: string
}

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  'aria-hidden': true,
  focusable: false as const,
})

export const IconPlus = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M8 3v10M3 8h10" />
  </svg>
)

export const IconSearch = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.2 10.2 13.5 13.5" />
  </svg>
)

export const IconSliders = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M2.4 5h11.2M2.4 11h11.2" />
    <circle cx="6.1" cy="5" r="1.75" />
    <circle cx="10.3" cy="11" r="1.75" />
  </svg>
)

export const IconPanelRight = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M10 3v10" />
  </svg>
)

export const IconSoundOn = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M8.5 3.2 5 6H2.8v4H5l3.5 2.8z" />
    <path d="M11 6.2a2.6 2.6 0 0 1 0 3.6" />
    <path d="M12.9 4.4a5.1 5.1 0 0 1 0 7.2" />
  </svg>
)

export const IconSoundOff = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M8.5 3.2 5 6H2.8v4H5l3.5 2.8z" />
    <path d="M11.2 6.4 13.8 9M13.8 6.4 11.2 9" />
  </svg>
)

export const IconSun = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1" />
  </svg>
)

export const IconMoon = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M13 9.6A5.4 5.4 0 0 1 6.4 3a5.4 5.4 0 1 0 6.6 6.6z" />
  </svg>
)

export const IconSend = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M2.5 8 13.5 3l-4.2 10-1.6-4.4z" />
  </svg>
)

export const IconStop = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="4.5" y="4.5" width="7" height="7" rx="1.2" />
  </svg>
)

export const IconFolder = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M2 5.5h4l1.5 2H14v6.5H2z" />
  </svg>
)

export const IconFile = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M9 1.8H4.6a1.2 1.2 0 0 0-1.2 1.2v10a1.2 1.2 0 0 0 1.2 1.2h6.8a1.2 1.2 0 0 0 1.2-1.2V5.2z" />
    <path d="M9 1.8v3.4h3.6" />
  </svg>
)

export const IconTerminal = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="1.8" y="3" width="12.4" height="10" rx="1.5" />
    <path d="M4.4 6.6 6.2 8.4 4.4 10.2M8 10.6h3.4" />
  </svg>
)

export const IconGrep = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="7" cy="7" r="4" />
    <path d="M10 10 13.6 13.6" />
    <path d="M5.2 7h3.6" />
  </svg>
)

export const IconGlobe = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="8" cy="8" r="6" />
    <path d="M2.2 8h11.6M8 2.2c1.7 1.7 2.5 3.7 2.5 5.8S9.7 12.1 8 13.8C6.3 12.1 5.5 10.1 5.5 8S6.3 3.9 8 2.2z" />
  </svg>
)

export const IconPencil = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M11.3 2.4 13.6 4.7 5.4 12.9l-3 .7.7-3z" />
  </svg>
)

export const IconAlert = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3.6M8 10.8v.6" />
  </svg>
)

export const IconCheck = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M3.4 8.4 6.4 11.4 12.6 5" />
  </svg>
)

export const IconChevron = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M6 4l4 4-4 4" />
  </svg>
)

export const IconPin = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M6.3 2.3h3.4l-.6 1.5v3l1.6 1.6H5.3l1.6-1.6v-3z" />
    <path d="M8 8.4v5.2" />
  </svg>
)

export const TOOL_ICON = {
  read_file: IconFile,
  grep: IconGrep,
  shell: IconTerminal,
  write_file: IconPencil,
  web_search: IconGlobe,
} as const
