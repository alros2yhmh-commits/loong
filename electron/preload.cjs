/* ---------------------------------------------------------------------------
   The bridge the renderer is allowed to see: a folder picker, external links,
   and the session token the main process minted. The agent's API key never
   crosses this boundary.
   --------------------------------------------------------------------------- */
const { contextBridge, ipcRenderer } = require('electron')

function sessionToken() {
  try {
    return String(ipcRenderer.sendSync('loong:token') ?? '')
  } catch {
    return ''
  }
}

contextBridge.exposeInMainWorld('loong', {
  token: sessionToken(),
  pickWorkspace: () => ipcRenderer.invoke('pick-workspace'),
  /* a link in a transcript is a reference, not a route: hand it to the OS
     instead of navigating the app */
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
})
