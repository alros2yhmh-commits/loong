const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, Menu, Notification, crashReporter } = require('electron')
const { spawn } = require('node:child_process')
const { join, dirname } = require('node:path')
const {
  existsSync,
  openSync,
  appendFileSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} = require('node:fs')
const { randomUUID } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { homedir } = require('node:os')
const http = require('node:http')

const AGENT_PORT = 5274
/* ---------------------------------------------------------------------------
   The session token.

   The agent listens on loopback, which every process on the machine can
   reach, and any web page can aim a browser at. A token minted here at
   launch — passed to the agent in its environment, handed to the renderer
   through the preload bridge — is what makes "local" mean "ours". It lives
   for one app run and dies with it.
   --------------------------------------------------------------------------- */
const sessionToken = randomUUID()

/* ---------------------------------------------------------------------------
   The key store.

   API keys used to sit in the renderer's localStorage — readable by any XSS
   in the interface. Now they are encrypted with the OS's own keychain
   (DPAPI on Windows, Keychain on macOS, Secret Service on Linux) through
   Electron's safeStorage, and live in a file only the main process reads.
   The renderer never sees a key again; it asks "is one set?" and sends a
   provider name. The agent receives the decrypted key over the spawn
   handshake file, which it deletes after reading.
   --------------------------------------------------------------------------- */
function keysFile() {
  return join(app.getPath('userData'), 'keys.enc')
}

function storeKey(provider, key) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    const all = readKeys()
    all[provider] = safeStorage.encryptString(key).toString('base64')
    writeFileSync(keysFile(), JSON.stringify(all), 'utf8')
    return true
  } catch (e) {
    diag(`storeKey failed: ${e.message}`)
    return false
  }
}

function readKeys() {
  try {
    if (!existsSync(keysFile())) return {}
    return JSON.parse(readFileSync(keysFile(), 'utf8'))
  } catch {
    return {}
  }
}

function hasKey(provider) {
  return Boolean(readKeys()[provider])
}

function storeKeysForAgent() {
  /* the decrypted keys are handed to the agent once, in a file it deletes */
  const all = readKeys()
  const plain = {}
  for (const [provider, enc] of Object.entries(all)) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        plain[provider] = safeStorage.decryptString(Buffer.from(enc, 'base64'))
      }
    } catch (e) {
      diag(`decrypt ${provider} failed: ${e.message}`)
    }
  }
  const file = join(app.getPath('userData'), 'keys.runtime.json')
  /* 0600: the file is plaintext, and only this account has any business reading
     it. On Windows the mode is advisory, so it is also removed on quit — see
     dropRuntimeKeys below. */
  writeFileSync(file, JSON.stringify(plain), { encoding: 'utf8', mode: 0o600 })
  return file
}

let agent = null
let win = null

/* The workspace is persisted so the app reopens in the folder the reader last
   chose, not the process's cwd. Stored in userData so it survives updates. */
function workspaceFile() {
  return join(app.getPath('userData'), 'workspace.txt')
}
function readStoredWorkspace() {
  try {
    const f = workspaceFile()
    if (existsSync(f)) {
      const ws = readFileSync(f, 'utf8').trim()
      if (ws && existsSync(ws)) return ws
    }
  } catch (e) {
    diag(`readStoredWorkspace failed: ${e.message}`)
  }
  return homedir()
}
function writeStoredWorkspace(ws) {
  try {
    writeFileSync(workspaceFile(), ws, 'utf8')
  } catch (e) {
    diag(`writeStoredWorkspace failed: ${e.message}`)
  }
}

let currentWorkspace = readStoredWorkspace()

/* A packaged GUI app has no console on Windows, so anything the main process
   wants to say has to go to a file or it is lost. It goes next to the app's own
   data, not in the user's home directory. */
function diag(message) {
  try {
    appendFileSync(
      join(app.getPath('userData'), 'loong.log'),
      `${new Date().toISOString()} ${message}\n`,
    )
  } catch {}
}

function agentPath() {
  const candidates = [
    join(process.resourcesPath || '', 'agent', 'loong-agent.cjs'),
    join(__dirname, '..', 'dist-agent', 'loong-agent.cjs'),
  ]
  for (const p of candidates) diag(`agentPath candidate ${p} exists=${existsSync(p)}`)
  const found = candidates.find((p) => existsSync(p)) || null
  diag(`agentPath chosen ${found}`)
  return found
}

function waitForAgent(tries = 60) {
  return new Promise((resolve) => {
    let n = 0
    const tick = () => {
      const req = http.get(
        `http://127.0.0.1:${AGENT_PORT}/api/health`,
        { headers: { 'x-loong-token': sessionToken } },
        (res) => {
          res.resume()
          if (res.statusCode === 200) return resolve(true)
          retry()
        },
      )
      req.on('error', retry)
      req.setTimeout(1000, () => {
        req.destroy()
        retry()
      })
      function retry() {
        if (++n >= tries) return resolve(false)
        setTimeout(tick, 500)
      }
    }
    tick()
  })
}

function startAgent(workspace) {
  diag(`startAgent workspace=${workspace} resourcesPath=${process.resourcesPath} dirname=${__dirname}`)
  const bundle = agentPath()
  if (!bundle) {
    console.error('[loong] agent bundle not found')
    diag('agent bundle not found')
    return Promise.resolve(false)
  }
  if (agent && !agent.killed) {
    try { agent.kill() } catch {}
  }
  /* the previous run's plaintext keys go before a new one is written */
  dropRuntimeKeys()
  currentWorkspace = workspace || currentWorkspace

  /* the agent's own output goes to a log file — with stdio ignored, a sidecar
     that dies on startup is invisible, which is how the packaged app shipped
     with "agent offline" and no explanation */
  let sink = 'ignore'
  try {
    sink = openSync(join(app.getPath('userData'), 'agent.log'), 'a')
  } catch (e) {
    diag(`agent.log open failed: ${e.message}`)
  }

  try {
    agent = spawn(process.execPath, [bundle], {
      /* the bundle now lives in resources/agent, a real directory; this also
         keeps working if it is ever resolved from inside app.asar */
      cwd: dirname(bundle),
      stdio: ['ignore', sink, sink],
      windowsHide: true,
      detached: false,
      env: {
        ...process.env,
        LOONG_PORT: String(AGENT_PORT),
        LOONG_WORKSPACE: currentWorkspace,
        LOONG_TOKEN: sessionToken,
        /* the decrypted keys, handed over once — the agent deletes after read */
        LOONG_KEY_FILE: storeKeysForAgent(),
        ELECTRON_RUN_AS_NODE: '1',
      },
    })
  } catch (e) {
    diag(`spawn threw: ${e.stack || e.message}`)
    return Promise.resolve(false)
  }
  agent.on('error', (e) => {
    console.error('[loong] agent spawn error:', e.message)
    diag(`spawn error event: ${e.message}`)
  })
  diag(`spawned agent pid=${agent.pid}`)
  return waitForAgent()
}

/* The plaintext key file exists only for the seconds between spawn and the
   agent's first read. If the agent dies before reading it — a bad bundle, a
   crash on startup — it must not be left behind on disk. */
function dropRuntimeKeys() {
  try {
    rmSync(join(app.getPath('userData'), 'keys.runtime.json'), { force: true })
  } catch (e) {
    diag(`dropRuntimeKeys failed: ${e.message}`)
  }
}

/* Where the interface itself lives. Navigation is allowed to this and to
   nothing else — see blockNavigation. */
function isAppUrl(target) {
  try {
    const t = new URL(target)
    const own = new URL(frontUrl())
    if (own.protocol === 'file:') {
      return t.protocol === 'file:' && t.pathname === own.pathname
    }
    return t.origin === own.origin
  } catch {
    return false
  }
}

function frontUrl() {
  if (app.isPackaged) {
    /* pathToFileURL is the only correct way to build a file URL on Windows:
       string interpolation produces file://C:\... which is not a valid URL
       and loads a blank page instead of the interface */
    return pathToFileURL(join(__dirname, '..', 'dist', 'index.html')).href
  }
  return 'http://localhost:5273'
}

/* The Edit menu is what wires Ctrl/Cmd+C, +V, +X and +A to the focused field.
   Without it the app is a text interface where text cannot be copied — which is
   exactly the bug the reader hit. */
function installMenu() {
  const template = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
  ]
  try {
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  } catch (e) {
    diag(`installMenu failed: ${e.message}`)
  }
}

async function createWindow() {
  await startAgent(currentWorkspace)
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    center: true,
    title: 'Loong',
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, 'preload.cjs'),
    },
  })
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          /* The renderer's job is to draw model output. Every directive here is
             about that output not being able to become a program: no plugins
             (object-src), no <base> rewriting where a relative URL points
             (base-uri), no being framed while an approval card is on screen
             (frame-ancestors), and no form that posts anywhere (form-action).
             connect-src is the one door out, and it is the local agent only. */
          "default-src 'self' file:; script-src 'self' file:; style-src 'self' file: 'unsafe-inline'; img-src 'self' file: data:; connect-src 'self' http://127.0.0.1:5274; font-src 'self' file: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        ],
      },
    })
  })
  /* A link the model wrote, or a page it fetched, must not be able to open a
     window of its own inside this app. Every popup is refused; an http(s)
     destination is handed to the real browser instead. `allow` used to be the
     answer for everything that was not http, which let file:// and custom
     schemes spawn a window with the preload bridge attached. */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  /* And the window itself may only ever show the interface. The preload bridge
     is attached to the window, not to an origin, so a page that takes the
     window over inherits `window.loong` — the session token included — and the
     agent trusts anything holding that token. Markdown output can produce such
     a link, so this is reachable without anyone attacking the app directly. */
  const blockNavigation = (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    diag(`blocked renderer navigation to ${url}`)
  }
  win.webContents.on('will-navigate', blockNavigation)
  win.webContents.on('will-redirect', blockNavigation)

  /* right-click: copy the selection, or paste into the composer — the same
     gestures the reader expects from any text app */
  win.webContents.on('context-menu', (_e, params) => {
    const items = []
    if (params.isEditable) {
      items.push(
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
      )
    } else if (params.selectionText) {
      items.push({ role: 'copy' })
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })

  /* a blank window is impossible to diagnose from the outside, so every load
     result and every renderer error goes to the log */
  win.webContents.on('did-finish-load', async () => {
    diag('renderer did-finish-load')
    /* objective proof that React actually painted, not just that HTML loaded */
    try {
      const n = await win.webContents.executeJavaScript(
        "document.getElementById('root')?.childElementCount ?? -1",
      )
      diag(`renderer root children=${n}`)
    } catch (e) {
      diag(`renderer root probe failed: ${e.message}`)
    }
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) =>
    diag(`renderer did-fail-load ${code} ${desc} ${url}`),
  )
  win.webContents.on('console-message', (_e, level, message) =>
    diag(`renderer console[${level}] ${message}`),
  )
  win.webContents.on('render-process-gone', (_e, details) =>
    diag(`renderer gone: ${details.reason}`),
  )

  const url = frontUrl()
  diag(`loading ${url}`)
  await win.loadURL(url)
}

ipcMain.handle('pick-workspace', async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Select workspace folder',
  })
  if (result.canceled || !result.filePaths?.length) return null
  const path = result.filePaths[0]
  writeStoredWorkspace(path)
  await startAgent(path)
  return path
})

ipcMain.handle('get-workspace', async () => currentWorkspace)

ipcMain.handle('get-token', async () => sessionToken)

/* The key store. `set` writes an OS-encrypted key and restarts the agent so
   the new key is in effect; `has` answers whether one exists without ever
   sending it back to the renderer. */
ipcMain.handle('set-key', async (_e, provider, key) => {
  if (!provider || typeof key !== 'string') return { ok: false }
  if (!key.trim()) {
    /* an empty key clears it */
    try {
      const all = readKeys()
      delete all[provider]
      writeFileSync(keysFile(), JSON.stringify(all), 'utf8')
      await startAgent(currentWorkspace)
      return { ok: true }
    } catch (e) {
      diag(`clearKey failed: ${e.message}`)
      return { ok: false }
    }
  }
  const ok = storeKey(String(provider), key.trim())
  if (ok) await startAgent(currentWorkspace)
  return { ok }
})

ipcMain.handle('has-key', async (_e, provider) => hasKey(String(provider)))

/* A run that finishes — or parks on an approval — while the window is in the
   background is exactly when the reader wants the OS to say so. The renderer
   only asks when it is hidden, so this never speaks over the app itself. */
ipcMain.handle('notify', async (_e, note) => {
  const title = String(note?.title ?? 'Loong').slice(0, 80)
  const body = String(note?.body ?? '').slice(0, 200)
  if (!body) return { ok: false }
  try {
    if (Notification.isSupported?.()) {
      new Notification({ title, body }).show()
      return { ok: true }
    }
  } catch (e) {
    diag(`notify failed: ${e.message}`)
  }
  return { ok: false }
})

/* local crash dumps — no server, no upload: a diagnostic file next to the
   app's own data so a crash can be understood instead of guessed at */
try {
  app.setPath('crashDumps', join(app.getPath('userData'), 'crashes'))
  crashReporter.start({
    productName: 'Loong',
    companyName: 'Loong',
    submitURL: '',
    uploadToServer: false,
    compress: false,
  })
} catch (e) {
  diag(`crashReporter start failed: ${e.message}`)
}

/* This is a text interface: there is no WebGL, no canvas, nothing that wants a
   GPU. Asking Chromium to software-render removes a whole class of startup
   crashes on machines with a broken or virtual display driver. */
app.disableHardwareAcceleration()

/* On some Windows setups — virtual machines, locked-down corporate images,
   remote sessions — Chromium's sandbox cannot start its GPU/renderer children
   and the app exits before a window exists. Double-clicking then looks like
   "nothing happens".

   That used to be answered by switching the sandbox off for everyone, which
   quietly turned `sandbox: true` in webPreferences into decoration: the renderer
   that parses model output and fetched pages ran unsandboxed on every machine,
   always, to spare a few from a startup crash. It is now the operator's
   decision, written down — LOONG_NO_SANDBOX=1 — and the default keeps the
   sandbox the platform offers. */
if (process.env.LOONG_NO_SANDBOX === '1') {
  diag('LOONG_NO_SANDBOX=1 — Chromium sandbox disabled by explicit request')
  app.commandLine.appendSwitch('no-sandbox')
}
app.commandLine.appendSwitch('disable-gpu-compositing')

app.whenReady().then(() => {
  installMenu()
  return createWindow()
}).catch((e) => {
  diag(`createWindow failed: ${e && (e.stack || e.message)}`)
})

app.on('window-all-closed', () => {
  try {
    if (agent && !agent.killed) agent.kill()
  } catch {}
  dropRuntimeKeys()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  try {
    if (agent && !agent.killed) agent.kill()
  } catch {}
  dropRuntimeKeys()
})
