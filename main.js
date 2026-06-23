const { app, BrowserWindow, ipcMain, Notification, shell, dialog, screen, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const APP_USER_MODEL_ID = 'com.staffping.app';
const ICON_PATH = path.join(__dirname, 'fusion-logo.png');

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

let win;
let db;
let lastCheckedDate = null;
let notifiedToday = new Set();

// Safely open external web links by strictly enforcing allowed protocols (HTTP/HTTPS/MAILTO)
function safeOpenExternal(url) {
  if (typeof url !== 'string') return;
  try {
    const parsedUrl = new URL(url);
    const allowedProtocols = ['http:', 'https:', 'mailto:'];
    if (allowedProtocols.includes(parsedUrl.protocol)) {
      shell.openExternal(url);
    }
  } catch (err) {
    console.error('Failed to parse URL for safeOpenExternal:', err);
  }
}

function forceWindowRelayout(browserWindow) {
  if (!browserWindow || browserWindow.isDestroyed()) return;
  const [w, h] = browserWindow.getContentSize();
  browserWindow.webContents.executeJavaScript(
    'window.dispatchEvent(new Event("resize"))',
    true
  ).catch(() => {});
  browserWindow.setContentSize(w + 1, h);
  browserWindow.setContentSize(w, h);
}

function createWindow() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  const indexPath = path.join(__dirname, 'index.html');

  win = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 800,
    minHeight: 550,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    backgroundColor: '#0d0f12',
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] Line ${line}: ${message}`);
  });

  win.webContents.setZoomLevel(0);
  win.webContents.setZoomFactor(1.0);

  win.loadFile(indexPath);

  win.webContents.once('did-finish-load', () => {
    win.maximize();
    win.show();
    win.webContents.setZoomFactor(1.0);
    forceWindowRelayout(win);
    win.focus();
    
    // Check reminders once the window has fully loaded and renderer is active
    console.log('[main] Window loaded, checking startup reminders...');
    checkTodayReminders();
  });


  // if (!app.isPackaged) {
  //   win.webContents.openDevTools();
  // }

  // Handle Ctrl+scroll / trackpad pinch zoom
  win.webContents.on('zoom-changed', (event, zoomDirection) => {
    const current = win.webContents.getZoomFactor();
    if (zoomDirection === 'in') {
      win.webContents.setZoomFactor(Math.min(parseFloat((current + 0.1).toFixed(2)), 3.0));
    } else {
      win.webContents.setZoomFactor(Math.max(parseFloat((current - 0.1).toFixed(2)), 0.25));
    }
  });

  // Handle Ctrl+= (zoom in), Ctrl+- (zoom out), Ctrl+0 (reset) keyboard shortcuts
  // Also handle F5 / Ctrl+R (reload) and Ctrl+Shift+R (hard reload)
  win.webContents.on('before-input-event', (event, input) => {
    const current = win.webContents.getZoomFactor();
    if (input.type === 'keyDown') {
      // F5 — soft reload (re-runs loadFile, preserving zoom)
      if (input.key === 'F5' && !input.control && !input.shift) {
        win.loadFile(path.join(__dirname, 'index.html'));
        event.preventDefault();
        return;
      }
      // Ctrl+R — soft reload
      if (input.control && !input.shift && input.key === 'r') {
        win.loadFile(path.join(__dirname, 'index.html'));
        event.preventDefault();
        return;
      }
      // Ctrl+Shift+R — hard reload (clears renderer cache)
      if (input.control && input.shift && input.key === 'R') {
        win.webContents.reloadIgnoringCache();
        event.preventDefault();
        return;
      }
      if (!input.control) return;
      if (input.key === '=' || input.key === '+') {
        win.webContents.setZoomFactor(Math.min(parseFloat((current + 0.1).toFixed(2)), 3.0));
        event.preventDefault();
      } else if (input.key === '-') {
        win.webContents.setZoomFactor(Math.max(parseFloat((current - 0.1).toFixed(2)), 0.25));
        event.preventDefault();
      } else if (input.key === '0') {
        win.webContents.setZoomFactor(1.0);
        event.preventDefault();
      }
    }
  });

  // Handle native mailto: and web link navigations securely
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('mailto:') || url.startsWith('http:') || url.startsWith('https:')) {
      safeOpenExternal(url);
    }
    return { action: 'deny' };
  });

  // Prevent auxclick and general in-app navigations to untrusted origins
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (url.startsWith('mailto:') || url.startsWith('http:') || url.startsWith('https:')) {
      safeOpenExternal(url);
    }
  });
}


app.whenReady().then(() => {
  // Clear Chromium's persisted zoom levels before creating the window
  const prefPath = path.join(app.getPath('userData'), 'Preferences');
  try {
    if (fs.existsSync(prefPath)) {
      const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf8'));
      if (prefs && prefs.partition && prefs.partition.per_host_zoom_levels) {
        prefs.partition.per_host_zoom_levels = {};
        fs.writeFileSync(prefPath, JSON.stringify(prefs, null, 2));
        console.log('[main] Cleared persisted zoom levels');
      }
    }
  } catch (e) {
    console.error('[main] Could not clear zoom prefs:', e);
  }

  Menu.setApplicationMenu(null);

  const { session } = require('electron');
  
  // Set permission request handler to deny geolocation, camera, etc. permissions inside the app
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    return callback(false);
  });

  db = require('./database');
  ensureWindowsNotificationShortcut();
  createWindow();
  // checkTodayReminders(); // Moved to window 'did-finish-load' to prevent race condition
  setInterval(checkTodayReminders, 60 * 1000);
});

// ── IPC Handlers ──

ipcMain.handle('get-employees', () => {
  try { return { success: true, data: db.getAll() }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('add-employee', (_, emp) => {
  try {
    db.add(emp);
    checkTodayReminders();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('update-employee', (_, emp) => {
  try {
    db.update(emp);
    checkTodayReminders();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('delete-employee', (_, emp_id) => {
  try { db.delete(emp_id); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('bulk-delete-employees', (_, emp_ids) => {
  try { db.bulkDelete(emp_ids); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('bulk-update-status-employees', (_, emp_ids, status) => {
  try {
    db.bulkUpdateStatus(emp_ids, status);
    checkTodayReminders();
    return { success: true };
  }
  catch (e) { return { success: false, error: e.message }; }
});


ipcMain.handle('clear-employees', () => {
  try {
    db.clearAll();
    checkTodayReminders();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-setting', (_, key) => {
  try { return { success: true, value: db.getSetting(key) }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('save-setting', (_, key, value) => {
  try {
    db.saveSetting(key, value);
    checkTodayReminders();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('export-pdf', async (event, htmlContent, password) => {
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  try {
    await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

    const options = {
      marginsType: 0,
      pageSize: 'A4',
      printBackground: true,
      landscape: false
    };

    const data = await printWin.webContents.printToPDF(options);
    printWin.destroy();

    const { filePath } = await dialog.showSaveDialog(win, {
      title: 'Export PDF Report',
      defaultPath: 'StaffPing_Directory_Report.pdf',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });

    if (filePath) {
      let writeBuffer = data;
      if (password && password.trim() !== '') {
        const { encryptPDF } = require('@pdfsmaller/pdf-encrypt');
        const encryptedBytes = await encryptPDF(new Uint8Array(data), password);
        writeBuffer = Buffer.from(encryptedBytes);
      }
      fs.writeFileSync(filePath, writeBuffer);
      return { success: true, path: filePath };
    }
    return { success: false, error: 'CANCELLED' };
  } catch (error) {
    if (!printWin.isDestroyed()) {
      printWin.destroy();
    }
    console.error('PDF export failed:', error);
    return { success: false, error: error.message };
  }
});


// Helper to prevent CSV injection (Formula Injection) in spreadsheet software
function escapeCSVValue(val) {
  if (val === undefined || val === null) return '""';
  let str = String(val).trim();
  // Prevent CSV Injection: If string starts with =, +, -, @, tab, or carriage return, prepend '
  if (str.length > 0 && /^[=\+\-\@\t\r]/.test(str)) {
    str = "'" + str;
  }
  // Double quotes inside a CSV field must be escaped by doubling them
  str = str.replace(/"/g, '""');
  return `"${str}"`;
}

// ── File Encryption / Decryption Helpers (AES-256-CBC with scrypt Sync Key Derivation) ──
const CRYPT_MAGIC = Buffer.from('STAFFPING_CRYPT_'); // 16 bytes

function encryptBuffer(buffer, password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([CRYPT_MAGIC, salt, iv, encrypted]);
}

function decryptBuffer(buffer, password) {
  if (buffer.length < 48 || !buffer.subarray(0, 16).equals(CRYPT_MAGIC)) {
    throw new Error('Invalid or unencrypted file format');
  }
  const salt = buffer.subarray(16, 32);
  const iv = buffer.subarray(32, 48);
  const encryptedData = buffer.subarray(48);
  const key = crypto.scryptSync(password, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
}

function isBufferEncrypted(buffer) {
  return buffer.length >= 48 && buffer.subarray(0, 16).equals(CRYPT_MAGIC);
}

// ── Data Export Handler ──
ipcMain.handle('export-data', async (_, password, format = 'csv') => {
  try {
    const employees = db.getAll();
    if (employees.length === 0) {
      return { success: false, error: 'No employee data available to export.' };
    }

    let writeBuffer;
    let defaultFileName = 'Staff_Directory.csv';
    let filters = [{ name: 'CSV Data Files', extensions: ['csv'] }];

    if (format === 'xlsx') {
      defaultFileName = 'Staff_Directory.xlsx';
      filters = [{ name: 'Excel Files', extensions: ['xlsx'] }];
      
      const XLSX = require('xlsx');
      const wb = XLSX.utils.book_new();
      const rows = employees.map(emp => ({
        'Employee ID': emp.emp_id,
        'Full Name': emp.name,
        'Department': emp.department || '',
        'Job Title': emp.job_title || '',
        'Email': emp.email || '',
        'Phone Number': emp.phone || '',
        'Date of Birth': emp.dob_display || '',
        'Joining Date': emp.joining_date_display || '',
        'Status': emp.status || 'Active'
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [
        { wch: 15 }, // Employee ID
        { wch: 25 }, // Full Name
        { wch: 20 }, // Department
        { wch: 25 }, // Job Title
        { wch: 30 }, // Email
        { wch: 18 }, // Phone Number
        { wch: 15 }, // Date of Birth
        { wch: 15 }, // Joining Date
        { wch: 12 }  // Status
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Employees');
      writeBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    } else {
      let fileContent = 'Employee ID,Full Name,Department,Job Title,Email,Phone Number,Date of Birth,Joining Date,Status\n';
      employees.forEach(emp => {
        const id = escapeCSVValue(emp.emp_id);
        const name = escapeCSVValue(emp.name);
        const department = escapeCSVValue(emp.department || '');
        const jobTitle = escapeCSVValue(emp.job_title || '');
        const email = escapeCSVValue(emp.email || '');
        const phone = escapeCSVValue(emp.phone || '');
        const dob = escapeCSVValue(emp.dob_display || '');
        const joining = escapeCSVValue(emp.joining_date_display || '');
        const status = escapeCSVValue(emp.status || 'Active');
        
        const csvContent = `${id},${name},${department},${jobTitle},${email},${phone},${dob},${joining},${status}\n`;
        fileContent += csvContent;
      });
      writeBuffer = Buffer.from(fileContent, 'utf8');
    }

    const { filePath } = await dialog.showSaveDialog(win, {
      title: `Export Employee Data (${format.toUpperCase()})`,
      defaultPath: defaultFileName,
      filters: filters
    });

    if (filePath) {
      if (password && password.trim() !== '') {
        writeBuffer = encryptBuffer(writeBuffer, password);
      }
      fs.writeFileSync(filePath, writeBuffer);
      return { success: true, path: filePath };
    } else {
      return { success: false, error: 'CANCELLED' }; 
    }

  } catch (error) {
    console.error('Export failed:', error);
    return { success: false, error: error.message };
  }
});

// ── Data Import Handler ──
ipcMain.handle('import-data', async (_, password, targetFilePath) => {
  try {
    let filePath = targetFilePath;
    if (!filePath) {
      const { filePaths } = await dialog.showOpenDialog(win, {
        title: 'Import Employee Data',
        properties: ['openFile'],
        filters: [{ name: 'CSV Data Files', extensions: ['csv'] }]
      });

      if (!filePaths || filePaths.length === 0) {
        return { success: false, error: 'CANCELLED' };
      }
      filePath = filePaths[0];
    }

    let fileBuffer = fs.readFileSync(filePath);
    if (isBufferEncrypted(fileBuffer)) {
      if (!password) {
        return { success: false, needsPassword: true, filePath };
      }
      try {
        fileBuffer = decryptBuffer(fileBuffer, password);
      } catch (e) {
        return { success: false, error: 'Incorrect decryption password or corrupted file.' };
      }
    }

    const rawData = fileBuffer.toString('utf8');
    const lines = rawData.split(/\r?\n/).filter(line => line.trim());

    if (lines.length <= 1) {
      return { success: false, error: 'File is empty or contains no employee data.' };
    }

    const employeesToImport = [];

    // Helper to clean CSV values (strips CSV injection escape quotes and wrapping double quotes)
    const cleanCSVValue = (val) => {
      if (val === undefined || val === null) return '';
      let str = String(val).trim();
      if (str.startsWith('"') && str.endsWith('"')) {
        str = str.slice(1, -1).trim();
      }
      if (str.startsWith("'") && str.length > 1 && /^[=\+\-\@\t\r]/.test(str.slice(1))) {
        str = str.slice(1);
      }
      if (str.startsWith('"') && str.endsWith('"')) {
        str = str.slice(1, -1).trim();
      }
      return str;
    };

    // Helper to safely convert exported text dates back into DB format (YYYY-MM-DD)
    // Uses Date.parse carefully: for "DD Mon YYYY" or ISO formats, parse then extract local parts
    const parseDateForDB = (dStr) => {
      if (!dStr || dStr === '—') return '';
      // Try to parse the date string
      const d = new Date(dStr);
      if (isNaN(d.getTime())) return '';
      // Use UTC methods if the string looks like YYYY-MM-DD (ISO), else local
      if (/^\d{4}-\d{2}-\d{2}$/.test(dStr.trim())) {
        // ISO string — read UTC values to avoid timezone day-shift
        const year  = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day   = String(d.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      // For human-readable strings like "08 Apr 1997", use local values
      const year  = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day   = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    // Dynamically parse CSV headers to determine index mappings
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
    const idIdx = headers.indexOf('employee id') !== -1 ? headers.indexOf('employee id') : 0;
    const nameIdx = headers.indexOf('full-name') !== -1 ? headers.indexOf('full-name') : (headers.indexOf('full name') !== -1 ? headers.indexOf('full name') : 1);
    const departmentIdx = headers.indexOf('department') !== -1 ? headers.indexOf('department') : (headers.indexOf('dept') !== -1 ? headers.indexOf('dept') : (headers.indexOf('dept.') !== -1 ? headers.indexOf('dept.') : -1));
    const jobTitleIdx = headers.indexOf('job title') !== -1 ? headers.indexOf('job title') : (headers.indexOf('title') !== -1 ? headers.indexOf('title') : -1);
    const emailIdx = headers.indexOf('email');
    const phoneIdx = headers.indexOf('phone number') !== -1 ? headers.indexOf('phone number') : (headers.indexOf('phone') !== -1 ? headers.indexOf('phone') : -1);
    
    let dobIdx = headers.indexOf('date of birth') !== -1 ? headers.indexOf('date of birth') : -1;
    if (dobIdx === -1) dobIdx = headers.indexOf('dob') !== -1 ? headers.indexOf('dob') : 5; // default fallback if headers missing
    
    let joinIdx = headers.indexOf('joining date') !== -1 ? headers.indexOf('joining date') : -1;
    if (joinIdx === -1) joinIdx = headers.indexOf('joining') !== -1 ? headers.indexOf('joining') : 6; // default fallback if headers missing

    // Custom CSV parser to handle quotes accurately
    for (let i = 1; i < lines.length; i++) {
      const result = [];
      let current = '';
      let inQuotes = false;
      const line = lines[i];

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"' && line[j+1] === '"') {
          current += '"';
          j++; // Skip escaped quote
        } else if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());

      // Ensure at least ID and Name exist before pushing
      if (result.length > Math.max(idIdx, nameIdx) && result[idIdx]) { 
        let rawId = cleanCSVValue(result[idIdx]);

        // Auto-pad numeric IDs with leading zeros (e.g., "2" becomes "002")
        // This ignores alphanumeric IDs like "EMP-001" to keep them safe.
        if (rawId && !isNaN(rawId)) {
          rawId = rawId.padStart(3, '0');
        }

        employeesToImport.push({
          emp_id: rawId,
          name: cleanCSVValue(result[nameIdx]),
          department: departmentIdx !== -1 ? cleanCSVValue(result[departmentIdx]) : '',
          job_title: jobTitleIdx !== -1 ? cleanCSVValue(result[jobTitleIdx]) : '',
          email: emailIdx !== -1 ? cleanCSVValue(result[emailIdx]) : '',
          phone: phoneIdx !== -1 ? cleanCSVValue(result[phoneIdx]).replace(/"/g, '').trim() : '',
          dob: result[dobIdx] ? parseDateForDB(cleanCSVValue(result[dobIdx])) : '',
          joining_date: result[joinIdx] ? parseDateForDB(cleanCSVValue(result[joinIdx])) : ''
        });
      }
    }

    db.importData(employeesToImport);

    // Reset notification state so fresh today-reminders fire for the new dataset
    // without this, the dedup logic would suppress all new notifications
    const notifPath = path.join(app.getPath('userData'), 'notif-state.json');
    try {
      fs.writeFileSync(notifPath, JSON.stringify({ date: '', notifications: {} }, null, 2));
      notifiedToday.clear();
    } catch (e) {
      console.error('Failed to reset notification state after import:', e);
    }

    checkTodayReminders(); // Fire fresh notifications for the newly imported data

    return { success: true, count: employeesToImport.length };

  } catch (error) {
    console.error('Import failed:', error);
    return { success: false, error: error.message };
  }
});

// ── Database Backup Handler ──
ipcMain.handle('backup-database', async (_, password) => {
  try {
    db.checkpoint();
    const sqliteDbPath = path.join(app.getPath('userData'), 'employees.db');
    const { filePath } = await dialog.showSaveDialog(win, {
      title: 'Backup Database',
      defaultPath: 'employees_backup.db',
      filters: [{ name: 'SQLite Database Files', extensions: ['db'] }]
    });

    if (filePath) {
      if (password && password.trim() !== '') {
        const buffer = fs.readFileSync(sqliteDbPath);
        const encrypted = encryptBuffer(buffer, password);
        fs.writeFileSync(filePath, encrypted);
      } else {
        fs.copyFileSync(sqliteDbPath, filePath);
      }
      return { success: true, path: filePath };
    } else {
      return { success: false, error: 'CANCELLED' };
    }
  } catch (e) {
    console.error('Backup failed:', e);
    return { success: false, error: e.message };
  }
});

// ── Database Restore Handler ──
ipcMain.handle('restore-database', async (_, password, targetFilePath) => {
  try {
    const sqliteDbPath = path.join(app.getPath('userData'), 'employees.db');
    let filePath = targetFilePath;
    if (!filePath) {
      const { filePaths } = await dialog.showOpenDialog(win, {
        title: 'Restore Database',
        properties: ['openFile'],
        filters: [{ name: 'SQLite Database Files', extensions: ['db'] }]
      });

      if (!filePaths || filePaths.length === 0) {
        return { success: false, error: 'CANCELLED' };
      }
      filePath = filePaths[0];
    }

    let fileBuffer = fs.readFileSync(filePath);
    if (isBufferEncrypted(fileBuffer)) {
      if (!password) {
        return { success: false, needsPassword: true, filePath };
      }
      try {
        fileBuffer = decryptBuffer(fileBuffer, password);
      } catch (e) {
        return { success: false, error: 'Incorrect decryption password or corrupted file.' };
      }
    }

    // Safe restore: Close DB first, write file, reopen DB.
    db.close();
    try {
      fs.writeFileSync(sqliteDbPath, fileBuffer);
      try { fs.unlinkSync(sqliteDbPath + '-wal'); } catch(e){}
      try { fs.unlinkSync(sqliteDbPath + '-shm'); } catch(e){}
    } catch (err) {
      db.reopen();
      throw err;
    }
    db.reopen();
    checkTodayReminders();
    return { success: true };
  } catch (e) {
    console.error('Restore failed:', e);
    return { success: false, error: e.message };
  }
});

// ── Clear Notification State Handler ──
ipcMain.handle('clear-notifications', () => {
  try {
    const notifPath = path.join(app.getPath('userData'), 'notif-state.json');
    if (fs.existsSync(notifPath)) {
      fs.writeFileSync(notifPath, JSON.stringify({ date: '', notifications: {} }, null, 2));
    }
    notifiedToday.clear();
    checkTodayReminders(true); // Instantly trigger a fresh scan of today's reminders (bypassing time constraint)
    return { success: true };
  } catch (e) {
    console.error('Clear notifications failed:', e);
    return { success: false, error: e.message };
  }
});

function formatTemplate(template, emp) {
  if (!template) return '';
  let yearsVal = '0';
  if (emp.joining_date) {
    try {
      const parts = emp.joining_date.split('-');
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        if (!isNaN(year)) {
          const currentYear = new Date().getFullYear();
          yearsVal = String(Math.max(0, currentYear - year));
        }
      }
    } catch (e) {
      console.error('Error parsing joining_date for template:', e);
    }
  }
  return template
    .replace(/{name}/g, emp.name || '')
    .replace(/{emp_id}/g, emp.emp_id || '')
    .replace(/{department}/g, emp.department || '')
    .replace(/{title}/g, emp.job_title || '')
    .replace(/{years}/g, yearsVal);
}

// ── Reminder logic ──
function checkTodayReminders(bypassTimeCheck = false) {
  try {
    const employees = db.getAll();
    const todayStr = new Date().toDateString();

    // Read notification history from renderer localStorage-compatible file
    const notifPath = path.join(app.getPath('userData'), 'notif-state.json');

    let notifState = {};

    if (fs.existsSync(notifPath)) {
      try {
        notifState = JSON.parse(fs.readFileSync(notifPath, 'utf8'));
      } catch {
        notifState = {};
      }
    }

    // Reset every new day
    if (notifState.date !== todayStr) {
      console.log(`[Reminders] Date changed from ${notifState.date} to ${todayStr}. Resetting notification tracker.`);
      notifState = {
        date: todayStr,
        notifications: {}
      };
    }

    if (!bypassTimeCheck) {
      // Check if the configured reminder time has been reached today
      const reminderTimeSetting = db.getSetting('reminder_time') || '09:00';
      const [targetHour, targetMin] = reminderTimeSetting.split(':').map(Number);
      const now = new Date();
      const currentMins = now.getHours() * 60 + now.getMinutes();
      const targetMins = targetHour * 60 + targetMin;

      console.log(`[Reminders] Time check: Current is ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')} (${currentMins} mins), Target is ${reminderTimeSetting} (${targetMins} mins)`);

      if (currentMins < targetMins) {
        return; // Before scheduled time, skip reminder check
      }
    } else {
      console.log('[Reminders] Bypassing scheduled time check (triggered by manual reset / import / save)');
    }

    console.log('[Reminders] Scanning employee records for today\'s milestones...');

    employees.forEach(emp => {
      if (emp.status === 'Inactive') return;
      // ── BIRTHDAY ──
      if (emp.isBirthday) {
        const key = `bday-${emp.emp_id}`;
        const existing = notifState.notifications[key];

        if (!existing || !existing.handled) {
          console.log(`[Reminders] Triggering birthday notification for ${emp.name}`);
          const rawSubject = db.getSetting('bday_subject') || 'Happy Birthday, {name}!';
          const rawBody = db.getSetting('bday_body') || 'Birthday and a great year ahead!\n\nBest regards,\nHR Team';
          
          const subject = formatTemplate(rawSubject, emp);
          const body = formatTemplate(rawBody, emp);

          sendPing(subject, body);

          notifState.notifications[key] = {
            handled: true,
            timestamp: Date.now()
          };
        } else {
          console.log(`[Reminders] Skipped birthday notification for ${emp.name} (already sent today)`);
        }
      }

      // ── ANNIVERSARY ──
      if (emp.isAnniversary) {
        const key = `anniv-${emp.emp_id}`;
        const existing = notifState.notifications[key];

        if (!existing || !existing.handled) {
          console.log(`[Reminders] Triggering work anniversary notification for ${emp.name}`);
          const rawSubject = db.getSetting('anniv_subject') || 'Happy Work Anniversary, {name}!';
          const rawBody = db.getSetting('anniv_body') || 'Dear {name},\n\nCongratulations on your work anniversary! Thank you for all your hard work and dedication.\n\nBest regards,\nHR Team';
          
          const subject = formatTemplate(rawSubject, emp);
          const body = formatTemplate(rawBody, emp);

          sendPing(subject, body);

          notifState.notifications[key] = {
            handled: true,
            timestamp: Date.now()
          };
        } else {
          console.log(`[Reminders] Skipped work anniversary notification for ${emp.name} (already sent today)`);
        }
      }
    });

    fs.writeFileSync(
      notifPath,
      JSON.stringify(notifState, null, 2)
    );

  } catch (e) {
    console.error('Reminder check failed:', e);
  }
}

function sendPing(title, body) {
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body, icon: ICON_PATH, silent: false });
      n.show();
    }
  } catch (e) {
    console.error('Notification error:', e);
  }
  if (win && !win.isDestroyed()) {
    win.webContents.send('ping', `${title}: ${body}`);
  }
}

function ensureWindowsNotificationShortcut() {
  if (process.platform !== 'win32') return;
  try {
    const shortcutPath = path.join(
      process.env.APPDATA || app.getPath('appData'),
      'Microsoft', 'Windows', 'Start Menu', 'Programs', 'StaffPing.lnk'
    );
    shell.writeShortcutLink(shortcutPath, 'create', {
      target: process.execPath,
      args: app.isPackaged ? '' : `"${app.getAppPath()}"`,
      cwd: app.getAppPath(),
      appUserModelId: APP_USER_MODEL_ID,
      description: 'StaffPing anniversary reminders',
      icon: app.isPackaged ? process.execPath : ICON_PATH,
      iconIndex: 0,
    });
  } catch (e) {
    console.error('Shortcut creation failed:', e);
  }
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });