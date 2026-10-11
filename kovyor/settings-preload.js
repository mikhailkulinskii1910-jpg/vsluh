const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cfg', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickImage: () => ipcRenderer.invoke('settings:pick-image'),
  autostart: (on) => ipcRenderer.invoke('settings:autostart', on),
  roll: () => ipcRenderer.invoke('settings:roll'),
});
