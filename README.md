# StaffPing — Anniversary & Birthday Notifier

> A lightweight desktop application for tracking employee birthdays and work anniversaries, with automatic daily desktop notifications.

Built with **Electron** + **SQLite** (`better-sqlite3`), StaffPing runs entirely offline — no server, no cloud, no accounts required.

---

## Features

- **Automatic daily reminders** — checks for birthdays and work anniversaries every hour and fires native OS desktop notifications
- **Notification history panel** — a slide-in drawer showing all past pings, filterable by type (Birthday / Anniversary / Unread)
- **Employee directory** — add, edit, delete, and search employees in a clean dark-themed table
- **CSV export** — export your full staff directory via a native Save As dialog
- **Light / Dark theme toggle**
- **Windows notification shortcut** — auto-creates a Start Menu shortcut so Windows toast notifications work correctly
- **Persistent notification state** — tracks which notifications have already fired today so you don't get duplicate pings across app restarts

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron |
| Database | SQLite via `better-sqlite3` |
| UI | Vanilla HTML/CSS/JS (single file) |
| IPC | Electron contextBridge + ipcMain/ipcRenderer |
| Notifications | Electron `Notification` API |

---

## Project Structure

```
anniversary-notifier/
├── main.js          # Electron main process — window, IPC handlers, reminder logic
├── preload.js       # Context bridge — exposes safe API to renderer
├── database.js      # SQLite setup, CRUD operations, date formatting
├── index.html       # Entire UI (styles + layout + JavaScript)
└── fusion-logo.png  # App icon used in notifications and window
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm

### Installation

```bash
git clone https://github.com/smrati/anniversary-notifier.git
cd anniversary-notifier
npm install
```

### Run in Development

```bash
npm start
```

### Build / Package

```bash
npm run build
```

> Packaging requires `electron-builder` or `electron-forge` configured in `package.json`.

---

## How It Works

### Reminder Checks

On launch, and then every **60 minutes**, the app:

1. Fetches all employees from SQLite
2. Compares each employee's date of birth and joining date against today's month and day
3. Fires a native desktop notification for any match
4. Persists a `notif-state.json` file in the user data directory to avoid re-notifying for the same event within the same calendar day

### Data Storage

The SQLite database (`employees.db`) and notification state file (`notif-state.json`) are stored in the OS user data directory:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\StaffPing\` |
| macOS | `~/Library/Application Support/StaffPing/` |
| Linux | `~/.config/StaffPing/` |

### Employee Schema

```sql
CREATE TABLE employees (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_id       TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  dob          TEXT,          -- ISO date: YYYY-MM-DD
  joining_date TEXT           -- ISO date: YYYY-MM-DD
);
```

---

## Usage

### Adding an Employee

Fill in the **Employee ID**, **Full Name**, **Date of Birth**, and **Joining Date** fields in the left panel and click **Add Employee** (or press Enter to tab through fields).

### Editing / Deleting

Each row in the table has **Edit** and **Delete** buttons. Editing pre-fills the form; saving updates the record in place.

### Searching

Use the search bar above the table to filter by Employee ID or name in real time.

### Exporting

Click **Export CSV** in the header to save a copy of the directory as a `.csv` file via the native OS save dialog.

### Notification Panel

Click the 🔔 bell icon in the header to open the notification history drawer. You can:
- Filter by **All**, **Unread**, **Birthday**, or **Anniversary**
- Mark individual notifications as seen
- Clear all notifications

---

## Windows Notes

On Windows, the app automatically creates a Start Menu shortcut (`StaffPing.lnk`) on first launch. This is required for the Windows notification system to correctly attribute toast notifications to the app.

---

## License

See `LICENSE` for details.