/* ---------------------------------------------------------------------------
   The desktop shell.

   Two processes, one seam: this file owns the window and the agent sidecar.
   The agent is spawned as a real child with a real cwd, and the interface
   loads over file:// — which is why the API base is absolute in the renderer.
   --------------------------------------------------------------------------- */
const { app, BrowserWindow, dialog, ipcMain } = require('electron')
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
      NO_PROXY: '127.0.0.1,localhost',
    },
    stdio: 'ignore',
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Loong',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
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
