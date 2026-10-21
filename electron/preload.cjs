const { contextBridge, ipcRenderer } = require('electron')

/* ---------------------------------------------------------------------------
   The bridge.

   Everything the interface needs from the main process arrives here, and
   nothing else does. The session token belongs on this list: it is how the
   renderer proves to the local agent that it is the app and not some other
   process — or some web page — knocking on 127.0.0.1.
   --------------------------------------------------------------------------- */

contextBridge.exposeInMainWorld('loong', {
  pickWorkspace: () => ipcRenderer.invoke('pick-workspace'),
  getWorkspace: () => ipcRenderer.invoke('get-workspace'),
  /** minted in main at launch, passed to the agent, valid for this app run */
  token: () => ipcRenderer.invoke('get-token'),
  /** the key store: write an OS-encrypted key, ask whether one exists.
      There is deliberately no "read the key back" — the renderer cannot. */
  setKey: (provider, key) => ipcRenderer.invoke('set-key', provider, key),
  hasKey: (provider) => ipcRenderer.invoke('has-key', provider),
  /** an OS notification, for a run that matters while the window is away */
  notify: (n) => ipcRenderer.invoke('notify', n),
})
