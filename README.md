# StaffPing — Premium HR Anniversary & Birthday Notifier

[![Platform](https://img.shields.io/badge/platform-Electron-rose.svg)](https://www.electronjs.org/)
[![Database](https://img.shields.io/badge/database-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)
[![License](https://img.shields.io/badge/license-ISC-green.svg)](LICENSE)

**StaffPing** is a premium, visual-centric desktop HR directory and milestone reminder application built for **Fusion Global Business Solutions**. It acts as an offline utility for HR teams to track employee records, monitor milestones (birthdays and work anniversaries), configure custom communication templates, and generate secure passcode-protected reports.

---

## ✨ Key Features

### 📅 Milestone Celebrations & Analytics
- **Today's Celebrations Banner:** A glowing gradient banner at the top of the directory view dynamically highlights today's birthdays and work anniversaries.
- **Insights & Dashboard:** Features a clean monthly calendar of upcoming events and provides department breakdown stats (headcount share, tenure trends).
- **Automated OS Notifications:** Automatically checks for milestones in the background and posts native Windows toast notifications at the exact scheduled hour.

### ⬆️ ⬇️ Dynamic Data Import & Export Dropdowns
- **Genuine Excel (XLSX) & CSV Exports:** Exports the directory via the `⬇ Export ▾` dropdown on the home screen into a native binary Excel sheet (`.xlsx`) or standard CSV.
- **Genuine Excel (XLSX) & CSV Imports:** Bulk-import employees via the `⬆ Import ▾` dropdown on the home screen from CSV or Excel files. Employs `UPSERT` matching logic to prevent duplicate records and automatically pads numeric IDs (e.g. `001`).
- **Passcode Protected PDFs:** Generates PDF directory reports encrypted with standard PDF security dictionaries. Open them in Chrome or Adobe Acrobat, and you will be natively prompted for the password.
- **Encrypted Imports:** Auto-detects if the imported file is encrypted (detecting the `STAFFPING_CRYPT_` header) and prompts the user for a passcode to decrypt and parse the data on-the-fly.

### 🛠 Settings & Template Customization
- **Tabbed Drawer Panel:** Right slide-in drawer containing configurations for notification times, backups, themes, and details.
- **Custom Template Editors:** Draft personalized birthday and work anniversary notifications using dynamic variables:
  - `{name}` — Employee's name
  - `{emp_id}` — Employee ID
  - `{department}` — Department name
  - `{title}` — Job title
  - `{years}` — Calculated milestone service tenure
- **Backup & Restore:** Manual database backups with option-based password encryption.

### 🎨 Visual & Styling Highlights
- **SaaS Dark Mode & Light Mode:** Tailored HSL themes utilizing rose/crimson accents, clean slate borders, and glassmorphic micro-shadows.
- **Harmonized Department Tags:** Auto-assigns pastel color indicators matching the department name to organize the view.
- **Bulk Actions:** Toggle status (Active/Inactive) or bulk-delete selected staff records in a single click.

---

## 🛠 Tech Stack

| Layer | Technology | Description |
| --- | --- | --- |
| **Desktop Shell** | Electron | Desktop container executing offline context isolation |
| **Database** | SQLite (`node:sqlite`) | Node's native secure SQLite execution engine |
| **Spreadsheets** | `xlsx` (SheetJS) | Native XML workbook reading and writing library |
| **PDF Encryption** | `@pdfsmaller/pdf-encrypt` | Cryptographic standard PDF security dictionaries |
| **UI Styling** | HTML5 / Vanilla CSS3 | Custom property styling with smooth CSS transitions |

---

## 📂 Project Structure

```
anniversary-notifier/
├── database.js          # Encrypted SQLite config and CRUD operations
├── main.js              # Electron lifecycle, IPC handlers, background reminder cron
├── preload.js           # Context bridge exposing secure Electron APIs
├── index.html           # Core UI, styling stylesheets, and renderer logic
├── PRODUCT_GUIDE.md     # Detailed features guide for project managers
└── package.json         # Build configuration and dependency declarations
```

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v22 or later (for native `node:sqlite` database capabilities)
- npm

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/smrati/anniversary-notifier.git
   cd anniversary-notifier
   ```
2. Install the offline dependencies:
   ```bash
   npm install
   ```

### Run in Development
Launch the Electron frame:
```bash
npm start
```

### Packaging for Release
Build standalone Windows executable releases:
```bash
npm run dist
```
Distributable installers will generate in the local `./dist/` directory.

---

## 🛡 Security & Encryption Details
- **Active DB:** Employee data is encrypted at the column level inside the local `employees.db` file using `aes-256-gcm` keys generated uniquely on first startup and persisted in the user folder (`db-key.enc`).
- **Encrypted Backups:** Secured backups utilize scrypt Sync key derivation to transform the user's password into a 256-bit key, applying AES-256-CBC encryption over the payload. File signatures start with the `STAFFPING_CRYPT_` magic header.
- **Standard PDF Security:** Encrypted PDF exports do not use a custom wrapper; instead, standard PDF security dictionaries are written directly to the document metadata, guaranteeing seamless integration with standard document viewers.

---

## 📄 License
Licensed under the ISC License. See `LICENSE` for details.