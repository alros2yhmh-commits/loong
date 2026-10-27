import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './config.ts'

/* ---------------------------------------------------------------------------
   The desktop, from the agent.

   A coding agent that can build an app but cannot OPEN it is testing its work
   through a keyhole. This is the other half: list the windows, launch the app,
   bring it forward, click where a person would click, type what a person would
   type, and take a screenshot that read_image can look at.

   Everything here runs through one PowerShell process per action — no shell
   string interpolation, values are quoted by `psQuote` — and every action is
   gated by the approval broker before it runs. A model cannot click "Delete"
   on the user's screen without the user seeing that it is about to.
   --------------------------------------------------------------------------- */

const exec = promisify(execFile)
const PS_TIMEOUT_MS = 20_000
const MAX_TEXT = 2_000

export type DesktopAction = 'list' | 'open' | 'focus' | 'click' | 'type' | 'key' | 'screenshot'

export interface DesktopInput {
  action: DesktopAction
  /** app path or name to launch, or window title / pid to focus */
  target?: string
  x?: number
  y?: number
  /** text to type */
  text?: string
  /** SendKeys chord, e.g. "^s" or "{ENTER}" */
  keys?: string
  button?: 'left' | 'right' | 'double'
}

/** single quotes are PowerShell's only safe delimiter; double them inside */
export function psQuote(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`
}

/** pure validation: the error a caller should see, or null when the input is usable */
export function validateDesktop(input: DesktopInput): string | null {
  if (process.platform !== 'win32') return 'Desktop control is available on Windows only. On this machine, use shell commands instead.'
  switch (input.action) {
    case 'list':
      return null
    case 'open': {
      const target = String(input.target ?? '').trim()
      if (!target) return 'Say what to open: an app path, an app name, or a URL.'
      if (target.length > 260) return 'That target is too long to be a path or a URL.'
      if (/[\r\n\0]/.test(target)) return 'The target contains a newline or a null byte.'
      return null
    }
    case 'focus': {
      const target = String(input.target ?? '').trim()
      if (!target) return 'Say which window: a title fragment or a process id.'
      if (target.length > 200) return 'That window title is too long.'
      return null
    }
    case 'click': {
      if (!Number.isInteger(input.x) || !Number.isInteger(input.y)) {
        return 'A click needs whole-number x and y screen coordinates.'
      }
      if (Math.abs(input.x!) > 20_000 || Math.abs(input.y!) > 20_000) {
        return 'Those coordinates are outside any real screen.'
      }
      return null
    }
    case 'type': {
      const text = String(input.text ?? '')
      if (!text) return 'There is no text to type.'
      if (text.length > MAX_TEXT) return `That is ${text.length} characters; type at most ${MAX_TEXT} at a time.`
      return null
    }
    case 'key': {
      const keys = String(input.keys ?? '').trim()
      if (!keys) return 'Say which keys to press, for example "^s" for Ctrl+S or "{ENTER}".'
      if (keys.length > 40 || !/^[A-Za-z0-9{}^%~+(). _-]+$/.test(keys)) {
        return 'That is not a SendKeys chord. Use key names in braces, e.g. "^s", "%{F4}", "{TAB}".'
      }
      return null
    }
    case 'screenshot':
      return null
    default:
      return `Unknown desktop action: ${String((input as { action?: unknown }).action)}`
  }
}

function script(input: DesktopInput): string {
  switch (input.action) {
    case 'list':
      return `
$rows = Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim() } |
  Select-Object Id, ProcessName, MainWindowTitle -First 60
$rows | ConvertTo-Json -Compress`
    case 'open': {
      const target = String(input.target ?? '').trim()
      return `Start-Process -FilePath ${psQuote(target)} -ErrorAction Stop; 'launched'`
    }
    case 'focus': {
      const target = String(input.target ?? '').trim()
      const asPid = /^\d+$/.test(target)
      return asPid
        ? `$w = New-Object -ComObject WScript.Shell; if (-not $w.AppActivate([int]${target})) { throw 'No window belongs to that process.' }; 'focused'`
        : `$w = New-Object -ComObject WScript.Shell; if (-not $w.AppActivate(${psQuote(target)})) { throw 'No window title matches that text.' }; 'focused'`
    }
    case 'click': {
      const button = input.button ?? 'left'
      const down = button === 'right' ? '0x0008' : '0x0002'
      const up = button === 'right' ? '0x0010' : '0x0004'
      const repeat = button === 'double' ? 2 : 1
      return `
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class LoongMouse{[DllImport("user32.dll")]public static extern bool SetCursorPos(int X,int Y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);}'
[void][LoongMouse]::SetCursorPos(${input.x}, ${input.y})
${Array.from({ length: repeat }, () => `[LoongMouse]::mouse_event(${down},0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [LoongMouse]::mouse_event(${up},0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 120`).join('\n')}
'clicked'`
    }
    case 'type': {
      const text = String(input.text ?? '')
      /* the clipboard is the only reliable path for Arabic, emoji and newlines:
         SendKeys types characters, not strings */
      return `
Set-Clipboard -Value ${psQuote(text)}
Start-Sleep -Milliseconds 120
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^v')
'typed'`
    }
    case 'key':
      return `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait(${psQuote(String(input.keys ?? ''))})
'pressed'`
    case 'screenshot': {
      const dir = join(DATA_DIR, 'desktop-shots')
      const file = join(dir, `shot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`)
      return `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$bmp.Save(${psQuote(file)}, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
${psQuote(file)}`
    }
  }
}

export interface DesktopResult {
  ok: boolean
  text: string
}

export async function runDesktop(input: DesktopInput): Promise<DesktopResult> {
  const invalid = validateDesktop(input)
  if (invalid) return { ok: false, text: invalid }

  if (input.action === 'screenshot') {
    try {
      mkdirSync(join(DATA_DIR, 'desktop-shots'), { recursive: true })
    } catch {
      return { ok: false, text: 'Could not create the screenshot folder.' }
    }
  }

  try {
    const { stdout } = await exec(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script(input)],
      { timeout: PS_TIMEOUT_MS, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
    )
    const body = stdout.trim()
    if (input.action === 'list') {
      if (!body) return { ok: true, text: 'No visible windows.' }
      try {
        const parsed = JSON.parse(body) as
          | { Id: number; ProcessName: string; MainWindowTitle: string }
          | { Id: number; ProcessName: string; MainWindowTitle: string }[]
        const rows = Array.isArray(parsed) ? parsed : [parsed]
        return {
          ok: true,
          text: rows
            .map((r) => `${r.Id}\t${r.ProcessName}\t${String(r.MainWindowTitle).trim()}`)
            .join('\n'),
        }
      } catch {
        return { ok: true, text: body }
      }
    }
    if (input.action === 'screenshot') {
      return { ok: true, text: `Screenshot saved: ${body}\nRead it with read_image.` }
    }
    return { ok: true, text: body || 'Done.' }
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    const why = (e.stderr || e.message || 'PowerShell failed').trim().slice(0, 800)
    return { ok: false, text: `The desktop action failed: ${why}` }
  }
}
