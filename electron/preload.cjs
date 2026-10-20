// Minimal bridge for the web UI: native notifications and desktop detection.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('acta', {
  isDesktop: true,
  platform: process.platform,
  notify: (title, body, id) => ipcRenderer.send('notify', { title, body, id }),
  onNotificationClick: (cb) => ipcRenderer.on('notification-click', (_e, id) => cb(id)),
});
