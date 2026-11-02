// The only desktop API the page sees: save files on disk, page zoom for the
// interface scale, and quitting.
'use strict';
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('ogDesktop', {
  saves: {
    list: () => ipcRenderer.invoke('saves:list'),
    read: id => ipcRenderer.invoke('saves:read', id),
    write: (meta, worldJson) => ipcRenderer.invoke('saves:write', meta, worldJson),
    remove: id => ipcRenderer.invoke('saves:remove', id),
    folder: () => ipcRenderer.invoke('saves:folder'),
    reveal: () => ipcRenderer.invoke('saves:reveal'),
  },
  view: {
    zoom: () => webFrame.getZoomFactor(),
    setZoom: factor => {
      if (typeof factor === 'number' && factor >= 0.5 && factor <= 3) webFrame.setZoomFactor(factor);
    },
  },
  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
  },
});
