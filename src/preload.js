const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  getClassCapture: () => ipcRenderer.invoke('class:capture:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  pickOutputDir: () => ipcRenderer.invoke('dialog:pickOutputDir'),
  openFolder: (folderPath) => ipcRenderer.invoke('folder:open', folderPath),
  exportLesson: (payload) => ipcRenderer.invoke('lesson:export', payload),
  onClassCaptureUpdate: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('class:capture-updated', handler);
    return () => ipcRenderer.removeListener('class:capture-updated', handler);
  },
  onExportProgress: (callback) => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on('lesson:export-progress', handler);
    return () => ipcRenderer.removeListener('lesson:export-progress', handler);
  },
});
