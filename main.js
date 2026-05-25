const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');

let win;
let db;

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
  createWindow();
  checkTodayReminders();
  // Check every hour
  setInterval(checkTodayReminders, 60 * 60 * 1000);
});

// ── IPC Handlers ──
ipcMain.handle('get-employees',    () => { try { return db.getAll(); } catch(e) { return []; } });
ipcMain.handle('add-employee',    (_, emp) => { try { db.add(emp); return { success: true }; } catch(e) { return { success: false, error: e.message }; } });
ipcMain.handle('update-employee', (_, emp) => { try { db.update(emp); return { success: true }; } catch(e) { return { success: false, error: e.message }; } });
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
    const mm = today.getMonth();
    const dd = today.getDate();

    employees.forEach(emp => {
      if (emp.dob) {
        const d = new Date(emp.dob);
        if (d.getMonth() === mm && d.getDate() === dd) {
          sendPing(`🎂 Birthday — ${emp.name}`, `${emp.name} (${emp.emp_id}) has a birthday today! Wish them well.`);
        }
      }
      if (emp.joining_date) {
        const d = new Date(emp.joining_date);
        if (d.getMonth() === mm && d.getDate() === dd) {
          sendPing(`🏅 Work Anniversary — ${emp.name}`, `${emp.name} (${emp.emp_id}) joined on this day. Celebrate their journey!`);
        }
      }
    });
  } catch(e) {
    console.error('Reminder check failed:', e);
  }
}

function sendPing(title, body) {
  // Desktop notification
  new Notification({ title, body }).show();
  // Also send to in-app toast
  if (win && !win.isDestroyed()) {
    win.webContents.send('ping', `${title}: ${body}`);
  }
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });