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

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 700,
    minWidth: 800, minHeight: 550,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
    backgroundColor: '#0d0f12',
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
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

// ── Data Export Handler ──
ipcMain.handle('export-data', async () => {
  try {
    const employees = db.getAll();
    if (employees.length === 0) {
      return { success: false, error: 'No employee data available to export.' };
    }

    // 1. Construct the CSV Header
    let csvContent = 'Employee ID,Full Name,Date of Birth,Joining Date\n';

    // 2. Map the SQLite database rows into CSV format
    employees.forEach(emp => {
      // Wrapping values in quotes prevents issues if names contain commas
      const id = `"${emp.emp_id}"`;
      const name = `"${emp.name}"`;
      const dob = `"${emp.dob_display}"`;
      const joining = `"${emp.joining_date_display}"`;
      
      csvContent += `${id},${name},${dob},${joining}\n`;
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

// ── Reminder logic ──
function checkTodayReminders() {
  try {
    const employees = db.getAll();
    const today = new Date();
    const todayStr = today.toDateString();

    const mm = today.getMonth();
    const dd = today.getDate();

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
      if (emp.dob) {
        const d = new Date(emp.dob);

        if (d.getMonth() === mm && d.getDate() === dd) {

          const key = `bday-${emp.emp_id}`;

          const existing = notifState.notifications[key];

          // Skip if already seen/dismissed/notified today
          if (existing && existing.handled) {
            return;
          }

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
      if (emp.joining_date) {
        const d = new Date(emp.joining_date);

        if (d.getMonth() === mm && d.getDate() === dd) {

          const key = `anniv-${emp.emp_id}`;

          const existing = notifState.notifications[key];

          if (existing && existing.handled) {
            return;
          }

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
      icon: ICON_PATH,
      iconIndex: 0,
    });
  } catch (e) {
    console.error('Shortcut creation failed:', e);
  }
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });