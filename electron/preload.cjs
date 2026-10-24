/* ---------------------------------------------------------------------------
   The bridge the renderer is allowed to see: a folder picker and nothing else.
   The agent's key never crosses this boundary.
   --------------------------------------------------------------------------- */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('loong', {
  pickWorkspace: () => ipcRenderer.invoke('pick-workspace'),
})
