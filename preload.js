const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getEmployees:   ()    => ipcRenderer.invoke('get-employees'),
  addEmployee:    (emp) => ipcRenderer.invoke('add-employee', emp),
  updateEmployee: (emp) => ipcRenderer.invoke('update-employee', emp),
  deleteEmployee: (id)  => ipcRenderer.invoke('delete-employee', id),
  exportData:     ()    => ipcRenderer.invoke('export-data'), // New export channel
  onPing: (cb) => ipcRenderer.on('ping', (_, msg) => cb(msg)),
});