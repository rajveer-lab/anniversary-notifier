# 🔔 Anniversary Notifier

A lightweight desktop application built with Electron.js that automatically sends desktop notifications when an employee's **birthday** or **work anniversary** matches today's date.

---

## ✨ Features

- Add, edit, and delete employee records
- Stores Employee ID, Full Name, Date of Birth, and Joining Date
- Automatic desktop ping on birthdays 🎂 and work anniversaries 🏅
- In-app toast notifications
- 4 built-in themes — Dark, Light, Blue, Green
- Search employees by name or ID
- Data stored locally using SQLite (sql.js) — no server needed

---

## 🛠️ Tech Stack

- [Electron.js](https://www.electronjs.org/) — Desktop app framework
- [sql.js](https://sql.js.org/) — SQLite in pure JavaScript (no native compilation needed)
- HTML / CSS / Vanilla JavaScript

---

## ⚙️ Setup & Installation

### Prerequisites

Make sure you have the following installed on your machine:

- [Node.js](https://nodejs.org/) (v18 or above recommended)
- [Git](https://git-scm.com/)

### 1. Clone the repository

```bash
git clone https://github.com/smrati/anniversary-notifier.git
cd anniversary-notifier
```

### 2. Switch to the development branch

```bash
git checkout private/rajveer/anniversary-notifier
```

### 3. Install dependencies

```bash
npm install
```

### 4. Run the app

```bash
npm start
```

The desktop application will launch automatically.

---

## 📁 Project Structure

| File | Purpose |
|------|---------|
| `index.html` | Main UI — form, table, theme switcher |
| `main.js` | Electron main process + notification logic |
| `preload.js` | IPC bridge between main and renderer |
| `database.js` | SQLite database operations |
| `package.json` | Project config and dependencies |

---

## 🔔 How Notifications Work

- On every app launch and every hour, the app checks all employee records
- If any employee's **date of birth** or **joining date** matches today's **day and month**, a desktop notification is sent automatically
- Notifications appear even if the app window is minimized

---

## 👤 Author

**Rajveer Chopra**  
[GitHub](https://github.com/smrati/anniversary-notifier)

---

## 📄 License

This project is licensed under the Apache-2.0 License.