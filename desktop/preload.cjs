// Exposes a file-backed StorageBackend to the page. src/save/storage.ts picks it up as globalThis.__shelfStorage.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('__shelfStorage', {
  get: (key) => ipcRenderer.invoke('storage:get', key),
  set: (key, value) => ipcRenderer.invoke('storage:set', key, value),
  delete: (key) => ipcRenderer.invoke('storage:delete', key),
  keys: () => ipcRenderer.invoke('storage:keys'),
});
contextBridge.exposeInMainWorld('__shelfDesktop', { platform: process.platform, unlockAchievement: (id) => ipcRenderer.invoke('steam:unlock', id) });
