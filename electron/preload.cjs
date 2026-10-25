/* ---------------------------------------------------------------------------
   The bridge the renderer is allowed to see: a folder picker and nothing else.
   The agent's key never crosses this boundary.
   --------------------------------------------------------------------------- */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('loong', {
  pickWorkspace: () => ipcRenderer.invoke('pick-workspace'),
  /* a link in a transcript is a reference, not a route: hand it to the OS
     instead of navigating the app */
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
})
