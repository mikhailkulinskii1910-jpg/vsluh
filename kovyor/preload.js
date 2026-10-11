const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  init: () => ipcRenderer.invoke('init'),
  hover: (over) => ipcRenderer.send('hover', over),
  drag: (on) => ipcRenderer.send('drag', on),
  menu: () => ipcRenderer.send('menu'),
  saveState: (s) => ipcRenderer.send('save-state', s),
  onCursor: (fn) => ipcRenderer.on('cursor', (_e, p) => fn(p)),
  quit: () => ipcRenderer.send('quit'),
  onSettings: (fn) => ipcRenderer.on('settings', (_e, st) => fn(st)),
  onEsc: (fn) => ipcRenderer.on('esc', (_e, k) => fn(k)),
  onCommand: (fn) => ipcRenderer.on('command', (_e, cmd, arg) => fn(cmd, arg)),
});
