// The only desktop API the page sees: save files on disk, and quitting.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ogDesktop', {
  saves: {
    list: () => ipcRenderer.invoke('saves:list'),
    read: id => ipcRenderer.invoke('saves:read', id),
    write: (meta, worldJson) => ipcRenderer.invoke('saves:write', meta, worldJson),
    remove: id => ipcRenderer.invoke('saves:remove', id),
    folder: () => ipcRenderer.invoke('saves:folder'),
    reveal: () => ipcRenderer.invoke('saves:reveal'),
  },
  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
  },
});
