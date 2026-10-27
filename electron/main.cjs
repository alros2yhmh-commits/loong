/* ---------------------------------------------------------------------------
   The desktop shell.

   Two processes, one seam: this file owns the window and the agent sidecar.
   The agent is spawned as a real child with a real cwd, and the interface
   loads over file:// — which is why the API base is absolute in the renderer.
   --------------------------------------------------------------------------- */
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const path = require('node:path')
const fs = require('node:fs')

const AGENT_PORT = 5274
const SESSION_TOKEN = crypto.randomBytes(24).toString('hex')
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
      LOONG_TOKEN: SESSION_TOKEN,
      LOONG_VERSION: app.getVersion(),
      /* No workspace is handed over on purpose. The sidecar used to start with
         the whole home folder as its root, which made "read the folder I
         opened" include Desktop, .agent-collab and this app's own source. The
         reader opens a folder in the interface; until then the file tools
         refuse, and the last chosen folder is restored from LOONG's data dir. */
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
    backgroundColor: '#1a1a1e',
    title: 'Loong',
    /* no OS title bar; Windows still draws min / max / close over the content
       through titleBarOverlay, so snap, resize and drag are native. The overlay
       colour is the app's canvas, not near-black: the two used to disagree, and
       the native buttons sat in a darker band that read as another application. */
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a1e',
      /* the ink is the app's text-2, so the native controls belong to the
         window instead of being the dimmest thing on it */
      symbolColor: '#c2c2bd',
      height: 38,
    },
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      /* The token reaches the renderer over a synchronous IPC call at preload
         time. It used to travel as a command-line argument, which made it
         readable by any process on the machine that could enumerate arguments
         — a credential in a list every monitoring tool prints. */
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  /* belt and braces: some Windows builds still paint the bar after autoHide */
  win.setMenuBarVisibility(false)

  /* The window shows one document, forever. Anything that would navigate the
     frame — a link in a transcript, a redirect, a drag-and-drop of a file onto
     the window — is either handed to the OS browser or refused. Without this,
     a crafted message could turn the app into a browser pointed at a page that
     can read the loopback API. */
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return
    event.preventDefault()
    try {
      const u = new URL(url)
      if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.toString())
    } catch {
      /* not a URL worth opening */
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url)
      if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.toString())
    } catch {
      /* not a URL worth opening */
    }
    return { action: 'deny' }
  })

  /* No webview, ever. The app has no feature that needs one, and an attached
     webview inherits the session. */
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())

  /* the renderer may never report a first paint here (no GPU process, hidden
     title bar), so ready-to-show is an optimisation, not the only path */
  let shown = false
  const show = () => {
    if (shown) return
    shown = true
    win.show()
    win.focus()
  }
  win.once('ready-to-show', show)
  win.webContents.on('did-finish-load', show)
  setTimeout(show, 2500)

  /* a renderer that fails to load must say so in the window, not in a log */
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    win.webContents
      .executeJavaScript(
        `document.body.innerHTML = '<pre style="font:13px monospace;color:#f4f4f2;background:#0e0e10;padding:24px;margin:0">' +
          'The interface failed to load.\\n\\n' + ${JSON.stringify(desc)} + ' (' + ${JSON.stringify(code)} + ')\\n' +
          ${JSON.stringify(url)} + '</pre>'`,
      )
      .catch(() => {})
    show()
  })
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

  /* Synchronous on purpose: the preload needs the token before any module
     script runs, and an async round-trip would race the first fetch. */
  ipcMain.on('loong:token', (event) => {
    event.returnValue = SESSION_TOKEN
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
