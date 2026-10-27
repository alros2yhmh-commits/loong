/* The desktop process owns the authenticated sidecar and the trusted renderer. */
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, protocol, safeStorage } = require('electron')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')

protocol.registerSchemesAsPrivileged([{ scheme: 'loong', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
} }])
const SESSION_TOKEN = crypto.randomBytes(24).toString('hex')
const SMOKE_TEST = process.argv.includes('--smoke-test')
let agent = null
let agentPort = 0
let mainWindow = null
let agentLog = null

function trustedSender(event) {
  try {
    const frame = event.senderFrame
    const url = new URL(frame.url)
    return frame === event.sender.mainFrame && url.protocol === 'loong:' && url.hostname === 'app'
  } catch { return false }
}
function requireTrusted(event) {
  if (!trustedSender(event)) throw new Error('Untrusted desktop sender')
}
function agentPath() {
  return [path.join(process.resourcesPath, 'agent', 'loong-agent.cjs'),
    path.join(__dirname, '..', 'dist-agent', 'loong-agent.cjs')].find((p) => fs.existsSync(p))
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}
/* The encrypted provider file uses an installation key wrapped by the OS
   keyring. A basic_text Linux backend is not treated as encryption. */
function credentialEncryptionKey(dataDir) {
  const file = path.join(dataDir, 'vault-key.bin')
  let available = false
  try {
    available = safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' &&
      safeStorage.getSelectedStorageBackend?.() === 'basic_text')
  } catch { /* a fresh headless environment may have no OS credential service */ }
  if (!available) {
    if (fs.existsSync(file)) throw new Error('The OS keyring is unavailable. Existing provider credentials were preserved; unlock the keyring and restart Loong.')
    return undefined
  }
  if (fs.existsSync(file)) {
    try {
      const value = safeStorage.decryptString(fs.readFileSync(file))
      const key = Buffer.from(value, 'base64')
      if (key.length !== 32 || key.toString('base64') !== value) throw new Error('Invalid vault key')
      return value
    } catch { throw new Error('The provider vault could not be unlocked. Existing credentials were preserved; restore the correct OS account/keyring or a backup.') }
  }
  const value = crypto.randomBytes(32).toString('base64')
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  try {
    fs.writeFileSync(temporary, safeStorage.encryptString(value), { flag: 'wx', mode: 0o600 })
    fs.renameSync(temporary, file)
    return value
  } catch { throw new Error('The OS-backed credential vault could not be created. Check the application data directory permissions.') }
  finally { fs.rmSync(temporary, { force: true }) }
}

async function startAgent() {
  const bundle = agentPath()
  if (!bundle) throw new Error('Agent bundle missing. Run npm run build before starting Loong.')
  agentPort = await freePort()
  const dataDir = process.env.LOONG_DATA_DIR || path.join(app.getPath('userData'), 'agent')
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const providedKey = process.env.LOONG_KEY_ENCRYPTION_KEY
  delete process.env.LOONG_KEY_ENCRYPTION_KEY
  const encryptionKey = providedKey || credentialEncryptionKey(dataDir)
  agentLog = fs.openSync(path.join(dataDir, 'agent-startup.log'), 'a', 0o600)
  agent = spawn(process.execPath, [bundle], {
    cwd: path.dirname(bundle),
    env: { ...process.env, ...(encryptionKey ? { LOONG_KEY_ENCRYPTION_KEY: encryptionKey } : {}), ELECTRON_RUN_AS_NODE: '1', LOONG_PORT: String(agentPort),
      LOONG_HOST: '127.0.0.1', LOONG_TOKEN: SESSION_TOKEN, LOONG_DATA_DIR: dataDir,
      LOONG_VERSION: app.getVersion(), NO_PROXY: '127.0.0.1,localhost' },
    stdio: ['ignore', agentLog, agentLog], windowsHide: true,
  })
  let startupError = null
  agent.once('error', (error) => { startupError = error })
  agent.once('exit', (code) => { if (code && !app.isQuitting) startupError = new Error(`Agent exited (${code}); see agent-startup.log.`) })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError) throw startupError
    try {
      const response = await fetch(`http://127.0.0.1:${agentPort}/api/health`, {
        headers: { 'x-loong-token': SESSION_TOKEN }, signal: AbortSignal.timeout(1500),
      })
      if (response.ok && (await response.json()).ok === true) return
    } catch { /* wait for the sidecar to open its socket */ }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('Agent did not become ready. See agent-startup.log in the application data folder.')
}
function registerRendererProtocol() {
  const dist = path.resolve(__dirname, '..', 'dist')
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' }
  protocol.handle('loong', (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'app' || request.method !== 'GET') return new Response('Forbidden', { status: 403 })
      const file = path.resolve(dist, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`)
      const relative = path.relative(dist, file)
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(file).isFile()) {
        return new Response('Not found', { status: 404 })
      }
      return new Response(fs.readFileSync(file), { headers: {
        'content-type': mime[path.extname(file)] || 'application/octet-stream',
        'x-content-type-options': 'nosniff',
      } })
    } catch { return new Response('Not found', { status: 404 }) }
  })
}
function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'editMenu' }, { role: 'windowMenu' }, {
    label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }],
  }]))
}
function openExternal(url) {
  try {
    const parsed = new URL(String(url))
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return shell.openExternal(parsed.toString())
  } catch { /* unsupported link */ }
}
function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 860, minWidth: 900, minHeight: 600,
    show: false, backgroundColor: '#1a1a1e', title: 'Loong', titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1a1e', symbolColor: '#c2c2bd', height: 38 }, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs') },
  })
  mainWindow = win
  win.setMenuBarVisibility(false)
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return
    event.preventDefault()
    void openExternal(url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => { void openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  win.once('ready-to-show', () => { if (!SMOKE_TEST) win.show() })
  win.webContents.once('did-finish-load', async () => {
    if (!SMOKE_TEST) { win.show(); return }
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const health = await fetch(window.loong.apiBase + '/api/health', {headers:{'x-loong-token':window.loong.token}});
        const body = await health.json();
        return {origin:location.protocol + '//' + location.host, api:health.status,
          healthy:body.ok === true, rendered:!!document.getElementById('root')?.children.length};
      })()`)
      if (result.origin !== 'loong://app' || result.api !== 200 || !result.healthy || !result.rendered) throw new Error(JSON.stringify(result))
      console.log('[loong-smoke] ' + JSON.stringify(result))
      app.exit(0)
    } catch (error) { console.error('[loong-smoke] ' + error.message); app.exit(1) }
  })
  win.webContents.on('did-fail-load', (_event, code, description) => {
    if (code === -3) return
    console.error(`Renderer failed to load: ${description}`)
    if (SMOKE_TEST) app.exit(1)
    else dialog.showErrorBox('Loong could not load', description)
  })
  void win.loadURL('loong://app/')
  return win
}

if (process.env.LOONG_DISABLE_SANDBOX === '1') app.commandLine.appendSwitch('no-sandbox')
if (process.env.LOONG_DISABLE_GPU === '1' || SMOKE_TEST) app.disableHardwareAcceleration()
if (!SMOKE_TEST && !app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus() }
  })
  app.whenReady().then(async () => {
    ipcMain.handle('pick-workspace', async (event) => {
      requireTrusted(event)
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      return result.canceled ? null : result.filePaths[0]
    })
    ipcMain.on('loong:config', (event) => {
      event.returnValue = trustedSender(event) ? { token: SESSION_TOKEN, apiBase: `http://127.0.0.1:${agentPort}` } : null
    })
    ipcMain.handle('open-external', (event, url) => { requireTrusted(event); return openExternal(url) })
    registerRendererProtocol()
    installMenu()
    await startAgent()
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  }).catch((error) => {
    console.error(error.message)
    if (!SMOKE_TEST) dialog.showErrorBox('Loong could not start', error.message)
    app.exit(1)
  })
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { app.isQuitting = true })
app.on('will-quit', () => { if (agent) agent.kill(); if (agentLog !== null) fs.closeSync(agentLog) })
app.on('quit', () => { if (agent) agent.kill() })
