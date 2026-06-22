const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getEmployees:   ()    => ipcRenderer.invoke('get-employees'),
  addEmployee:    (emp) => ipcRenderer.invoke('add-employee', emp),
  updateEmployee: (emp) => ipcRenderer.invoke('update-employee', emp),
  deleteEmployee: (id)  => ipcRenderer.invoke('delete-employee', id),
  clearEmployees: ()    => ipcRenderer.invoke('clear-employees'),
  exportData:     (password)    => ipcRenderer.invoke('export-data', password),
  importData:     (password, filePath)    => ipcRenderer.invoke('import-data', password, filePath),
  backupDatabase: (password)    => ipcRenderer.invoke('backup-database', password),
  restoreDatabase:(password, filePath)    => ipcRenderer.invoke('restore-database', password, filePath),
  clearNotifications: () => ipcRenderer.invoke('clear-notifications'),
  bulkDeleteEmployees: (ids) => ipcRenderer.invoke('bulk-delete-employees', ids),
  bulkUpdateStatusEmployees: (ids, status) => ipcRenderer.invoke('bulk-update-status-employees', ids, status),
 onPing: (cb) => {
  const listener = (_, msg) => cb(msg);
  ipcRenderer.on('ping', listener);

  return () => {
    ipcRenderer.removeListener('ping', listener);
  };
},
});