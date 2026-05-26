const { app, BrowserWindow, ipcMain, Notification, shell } = require('electron');
const path = require('path');

const APP_USER_MODEL_ID = 'com.staffping.app';
const ICON_PATH = path.join(__dirname, 'fusion-logo.png');

// Required for Windows toast notifications.
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
  // Check every hour
  setInterval(checkTodayReminders, 60 * 60 * 1000);
});

// ── IPC Handlers ──
ipcMain.handle('get-employees',    () => { try { return db.getAll(); } catch(e) { return []; } });
ipcMain.handle('add-employee',    (_, emp) => {
  try {
    db.add(emp);
    checkTodayReminders();
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('update-employee', (_, emp) => {
  try {
    db.update(emp);
    checkTodayReminders();
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('delete-employee', (_, id)  => { try { db.delete(id); return { success: true }; } catch(e) { return { success: false, error: e.message }; } });

// ── Test notification ──
ipcMain.handle('test-notification', () => {
  sendPing('🔔 Test Ping', 'StaffPing is working! You will be notified on birthdays & anniversaries.');
});

// ── Reminder logic ──
function checkTodayReminders() {
  try {
    const employees = db.getAll();
    const today = new Date();
    const todayStr = today.toDateString(); // e.g., "Tue May 26 2026"
    const mm = today.getMonth();
    const dd = today.getDate();

    // If the day has changed (e.g., midnight passed), clear the tracking Set
    if (lastCheckedDate !== todayStr) {
      notifiedToday.clear();
      lastCheckedDate = todayStr;
    }

    console.log(`Checking reminders for ${dd}/${mm + 1} — ${employees.length} employees`);

    employees.forEach(emp => {
      // --- Birthday Check ---
      if (emp.dob) {
        const d = new Date(emp.dob);
        const bdayKey = `bday-${emp.emp_id}`; // Create a unique key for this event

        if (d.getMonth() === mm && d.getDate() === dd && !notifiedToday.has(bdayKey)) {
          console.log(`Birthday match: ${emp.name}`);
          sendPing(`🎂 Birthday — ${emp.name}`, `${emp.name} (${emp.emp_id}) has a birthday today! Wish them well.`);
          notifiedToday.add(bdayKey); // Mark as notified so it doesn't fire again today
        }
      }

      // --- Work Anniversary Check ---
      if (emp.joining_date) {
        const d = new Date(emp.joining_date);
        const annivKey = `anniv-${emp.emp_id}`;

        if (d.getMonth() === mm && d.getDate() === dd && !notifiedToday.has(annivKey)) {
          console.log(`Anniversary match: ${emp.name}`);
          sendPing(`🏅 Work Anniversary — ${emp.name}`, `${emp.name} (${emp.emp_id}) joined on this day. Celebrate their journey!`);
          notifiedToday.add(annivKey); // Mark as notified
        }
      }
    });
  } catch(e) {
    console.error('Reminder check failed:', e);
  }
}
function sendPing(title, body) {
  const message = `${title}: ${body}`;

  try {
    if (!Notification.isSupported()) {
      throw new Error('Desktop notifications are not supported on this system.');
    }

    const notification = new Notification({
      title,
      body,
      icon: ICON_PATH,
      silent: false,
    });

    notification.on('failed', (_, error) => {
      console.error('Notification failed:', error);
      sendToast(`Notification failed: ${error || 'Windows blocked the toast.'}`);
    });

    notification.show();
  } catch (e) {
    console.error('Notification failed:', e);
    sendToast(`Notification failed: ${e.message}`);
  }

  sendToast(message);
}

function sendToast(message) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('ping', message);
  }
}

function ensureWindowsNotificationShortcut() {
  if (process.platform !== 'win32') return;

  try {
    const startMenuRoot = path.join(
      process.env.APPDATA || app.getPath('appData'),
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs'
    );
    const shortcutPath = path.join(startMenuRoot, 'StaffPing.lnk');
    const args = app.isPackaged ? '' : `"${app.getAppPath()}"`;

    shell.writeShortcutLink(shortcutPath, 'create', {
      target: process.execPath,
      args,
      cwd: app.getAppPath(),
      appUserModelId: APP_USER_MODEL_ID,
      description: 'StaffPing anniversary reminders',
      icon: ICON_PATH,
      iconIndex: 0,
    });
  } catch (e) {
    console.error('Unable to create Windows notification shortcut:', e);
  }
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
