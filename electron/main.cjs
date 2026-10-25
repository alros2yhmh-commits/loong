/* ---------------------------------------------------------------------------
   The desktop shell.

   Two processes, one seam: this file owns the window and the agent sidecar.
   The agent is spawned as a real child with a real cwd, and the interface
   loads over file:// — which is why the API base is absolute in the renderer.
   --------------------------------------------------------------------------- */
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const AGENT_PORT = 5274
let agent = null

function agentPath() {
  const candidates = [
    path.join(process.resourcesPath, 'agent', 'loong-agent.cjs'),
    path.join(__dirname, '..', 'dist-agent', 'loong-agent.cjs'),
  ]
  for (const p of candidates) if (fs.existsSync(p)) return p
  return null
}

function startAgent() {
  const bundle = agentPath()
  if (!bundle) return
  agent = spawn(process.execPath, [bundle], {
    cwd: path.dirname(bundle),
    /* Electron's binary is the only node we are guaranteed to have next to
       the app; ELECTRON_RUN_AS_NODE is what makes it behave as one. */
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      LOONG_PORT: String(AGENT_PORT),
      /* a fresh install must work in the reader's folder, not in the folder the
         sidecar happens to live in */
      LOONG_WORKSPACE: app.getPath('home'),
      NO_PROXY: '127.0.0.1,localhost',
    },
    stdio: 'ignore',
  })
}

/* A menu with only the roles the accelerators need. It is never shown: the
   bar is hidden below, but the roles stay registered so Ctrl+C, Ctrl+V,
   Ctrl+A, Ctrl+Z, Ctrl+W and Ctrl+Q keep working. */
function installMenu() {
  const menu = Menu.buildFromTemplate([
    { role: 'editMenu' },
    { role: 'windowMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ])
  Menu.setApplicationMenu(menu)
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Loong',
    /* no OS title bar; Windows still draws min / max / close over the content
       through titleBarOverlay, so snap, resize and drag are native */
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0e0e10',
      symbolColor: '#a3a39e',
      height: 38,
    },
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  /* belt and braces: some Windows builds still paint the bar after autoHide */
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => win.show())
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  return win
}

/* This sandbox has no usable GPU process and its Chromium sandbox cannot start
   renderer children. Both flags are what let the app launch here at all; the
   renderer still has contextIsolation, nodeIntegration off, and loads only
   local files plus loopback. */
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu-compositing')

app.whenReady().then(() => {
  /* the folder picker: the renderer asks, the main process asks the OS */
  ipcMain.handle('pick-workspace', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('open-external', async (_e, url) => {
    /* only http(s) leaves the app — a file: or javascript: URL is a route, not
       a link, and neither should be opened from a transcript */
    try {
      const u = new URL(String(url))
      if (u.protocol === 'http:' || u.protocol === 'https:') await shell.openExternal(u.toString())
    } catch {
      /* an unparseable link is not worth a dialog */
    }
  })

  installMenu()
  startAgent()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('quit', () => {
  if (agent) agent.kill()
})
