/* A narrow bridge. Provider keys never pass through it. */
const { contextBridge, ipcRenderer } = require('electron')
let config = { token: '', apiBase: '' }
try { config = ipcRenderer.sendSync('loong:config') || config } catch {}
contextBridge.exposeInMainWorld('loong', {
  token: config.token,
  apiBase: config.apiBase,
  pickWorkspace: () => ipcRenderer.invoke('pick-workspace'),
  openExternal: (url) => ipcRenderer.invoke('open-external', String(url)),
})
