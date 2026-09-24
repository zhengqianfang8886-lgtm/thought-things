const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (cmd, args) => ipcRenderer.invoke('tauri-invoke', cmd, args),
});
