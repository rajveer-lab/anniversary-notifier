const { app, BrowserWindow, ipcMain, Notification, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

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

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 700,
    minWidth: 800, minHeight: 550,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    backgroundColor: '#0d0f12',
  });
  win.loadFile('index.html');
  // if (!app.isPackaged) {
  //   win.webContents.openDevTools();
  // }

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
  const { session } = require('electron');
  
  // Set permission request handler to deny geolocation, camera, etc. permissions inside the app
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    return callback(false);
  });

  db = require('./database');
  ensureWindowsNotificationShortcut();
  createWindow();
  checkTodayReminders();
  setInterval(checkTodayReminders, 60 * 60 * 1000);
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

ipcMain.handle('clear-employees', () => {
  try {
    db.clearAll();
    checkTodayReminders();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
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

// ── Data Export Handler ──
ipcMain.handle('export-data', async () => {
  try {
    const employees = db.getAll();
    if (employees.length === 0) {
      return { success: false, error: 'No employee data available to export.' };
    }

    // 1. Construct the CSV Header
    let csvContent = 'Employee ID,Full Name,Department,Job Title,Email,Date of Birth,Joining Date\n';

    // 2. Map the SQLite database rows into CSV format
    employees.forEach(emp => {
      const id = escapeCSVValue(emp.emp_id);
      const name = escapeCSVValue(emp.name);
      const department = escapeCSVValue(emp.department || '');
      const jobTitle = escapeCSVValue(emp.job_title || '');
      const email = escapeCSVValue(emp.email || '');
      const dob = escapeCSVValue(emp.dob_display || '');
      const joining = escapeCSVValue(emp.joining_date_display || '');
      
      csvContent += `${id},${name},${department},${jobTitle},${email},${dob},${joining}\n`;
    });

    // 3. Open the native OS "Save As" window
    const { filePath } = await dialog.showSaveDialog(win, {
      title: 'Export Employee Data',
      defaultPath: 'Staff_Directory.csv',
      filters: [{ name: 'CSV Data Files', extensions: ['csv'] }]
    });

    // 4. If the user didn't cancel, write the file to their chosen path
    if (filePath) {
      fs.writeFileSync(filePath, csvContent, 'utf8');
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
ipcMain.handle('import-data', async () => {
  try {
    const { filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import Employee Data',
      properties: ['openFile'],
      filters: [{ name: 'CSV Data Files', extensions: ['csv'] }]
    });

    if (!filePaths || filePaths.length === 0) {
      return { success: false, error: 'CANCELLED' };
    }

    const rawData = fs.readFileSync(filePaths[0], 'utf8');
    const lines = rawData.split(/\r?\n/).filter(line => line.trim());

    if (lines.length <= 1) {
      return { success: false, error: 'File is empty or contains no employee data.' };
    }

    const employeesToImport = [];

    // Helper to clean CSV values (strips CSV injection escape quotes)
    const cleanCSVValue = (val) => {
      if (val === undefined || val === null) return '';
      let str = String(val).trim();
      if (str.startsWith("'") && str.length > 1 && /^[=\+\-\@\t\r]/.test(str.slice(1))) {
        str = str.slice(1);
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
          dob: result[dobIdx] ? parseDateForDB(cleanCSVValue(result[dobIdx])) : '',
          joining_date: result[joinIdx] ? parseDateForDB(cleanCSVValue(result[joinIdx])) : ''
        });
      }
    }

    db.importData(employeesToImport);
    checkTodayReminders(); // Refresh notifications in case imported users have birthdays today

    return { success: true, count: employeesToImport.length };

  } catch (error) {
    console.error('Import failed:', error);
    return { success: false, error: error.message };
  }
});

// ── Database Backup Handler ──
ipcMain.handle('backup-database', async () => {
  try {
    const sqliteDbPath = path.join(app.getPath('userData'), 'employees.db');
    const { filePath } = await dialog.showSaveDialog(win, {
      title: 'Backup Database',
      defaultPath: 'employees_backup.db',
      filters: [{ name: 'SQLite Database Files', extensions: ['db'] }]
    });

    if (filePath) {
      fs.copyFileSync(sqliteDbPath, filePath);
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
ipcMain.handle('restore-database', async () => {
  try {
    const sqliteDbPath = path.join(app.getPath('userData'), 'employees.db');
    const { filePaths } = await dialog.showOpenDialog(win, {
      title: 'Restore Database',
      properties: ['openFile'],
      filters: [{ name: 'SQLite Database Files', extensions: ['db'] }]
    });

    if (!filePaths || filePaths.length === 0) {
      return { success: false, error: 'CANCELLED' };
    }

    // Safe restore: Close DB first, copy file, reopen DB.
    db.reopen();
    try {
      fs.copyFileSync(filePaths[0], sqliteDbPath);
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
    return { success: true };
  } catch (e) {
    console.error('Clear notifications failed:', e);
    return { success: false, error: e.message };
  }
});

// ── Reminder logic ──
function checkTodayReminders() {
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
      notifState = {
        date: todayStr,
        notifications: {}
      };
    }

    employees.forEach(emp => {
      // ── BIRTHDAY ──
      if (emp.isBirthday) {
        const key = `bday-${emp.emp_id}`;
        const existing = notifState.notifications[key];

        if (!existing || !existing.handled) {
          sendPing(
            `🎂 Birthday — ${emp.name}`,
            `${emp.name} (${emp.emp_id}) has a birthday today!`
          );

          notifState.notifications[key] = {
            handled: true,
            timestamp: Date.now()
          };
        }
      }

      // ── ANNIVERSARY ──
      if (emp.isAnniversary) {
        const key = `anniv-${emp.emp_id}`;
        const existing = notifState.notifications[key];

        if (!existing || !existing.handled) {
          sendPing(
            `🏅 Work Anniversary — ${emp.name}`,
            `${emp.name} (${emp.emp_id}) joined on this day!`
          );

          notifState.notifications[key] = {
            handled: true,
            timestamp: Date.now()
          };
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