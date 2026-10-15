# StaffPing — Premium HR Anniversary & Birthday Notifier

[![Platform](https://img.shields.io/badge/platform-Electron-rose.svg)](https://www.electronjs.org/)
[![Database](https://img.shields.io/badge/database-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)
[![License](https://img.shields.io/badge/license-ISC-green.svg)](LICENSE)

**StaffPing** is a premium, visual-centric desktop HR directory and milestone reminder application built for **StaffPing**. It acts as an offline utility for HR teams to track employee records, monitor milestones (birthdays and work anniversaries), configure custom communication templates, and generate secure passcode-protected reports.

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

### 🗂 Departments, History & Database Health
- **Managed Departments:** Departments are their own table. Add, rename or delete them in Settings → Departments; renaming one onto an existing name merges the two, and a department that still has people cannot be deleted.
- **Change History:** Editing an employee shows every status, department and ID change plus each greeting sent, recorded by database triggers.
- **Department Filter:** Narrow the directory to one department (or to people without one).
- **Database Status:** Settings → Data shows the schema version, integrity and foreign-key checks, and row counts per table.

### 🎨 Visual & Styling Highlights
- **Quiet Light & Dark Themes:** Warm neutral surfaces and the native Windows font; the brand red is reserved for today's milestones and unread notifications.
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
├── database.js          # Schema, versioned migrations, triggers/views, encrypted CRUD
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
   git clone https://github.com/rajveer-lab/anniversary-notifier.git
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

## 🗄 Database Design

The database (`employees.db`, SQLite in WAL mode with foreign keys enforced) is at schema version 2:

| Table | Purpose | Key rules |
| --- | --- | --- |
| `departments` | One row per department | `name` is `UNIQUE COLLATE NOCASE`, so "HR" and "hr" are the same department |
| `employees` | The directory | `emp_id` is `UNIQUE`; `dept_id` → `departments` with `ON DELETE RESTRICT`; `status` has `CHECK (status IN ('Active','Inactive'))` |
| `employee_audit` | Change history | Written only by `AFTER INSERT/UPDATE/DELETE` triggers on `employees`; no foreign key, so history outlives the employee |
| `notification_log` | Greetings sent | `PRIMARY KEY (emp_ref, kind, year)` allows one birthday and one anniversary greeting per person per year; `ON DELETE CASCADE` |
| `settings` | Reminder time and message templates | Key/value |

Views `v_employee_directory` (employees joined to their department) and `v_department_summary` (headcount per department with `GROUP BY`) back the directory and the Departments screen, and indexes on `employees(dept_id)`, `employees(status)` and `employee_audit(emp_ref)` serve the join, the status filter and the history lookup.

Schema changes are numbered with `PRAGMA user_version`. Opening an older database first writes a consistent copy with `VACUUM INTO` (`employees.pre-v2.db`), then rebuilds `employees` inside one transaction, because SQLite cannot add `CHECK` or foreign-key constraints to existing columns. Row IDs and the `AUTOINCREMENT` counter are preserved, and restored backups go through the same migration.

## 🛡 Security & Encryption Details
- **Active DB:** Personal fields (name, dates of birth and joining, email, phone, job title) are encrypted at the column level inside `employees.db` using `aes-256-gcm` with a key generated on first startup and kept in the user folder (`db-key.enc`). Status and department are not personal data, so they stay in plain columns where SQLite can constrain, index and aggregate them.
- **Encrypted Backups:** Secured backups utilize scrypt Sync key derivation to transform the user's password into a 256-bit key, applying AES-256-CBC encryption over the payload. File signatures start with the `STAFFPING_CRYPT_` magic header.
- **Standard PDF Security:** Encrypted PDF exports do not use a custom wrapper; instead, standard PDF security dictionaries are written directly to the document metadata, guaranteeing seamless integration with standard document viewers.

---

## 📄 License
Licensed under the ISC License. See `LICENSE` for details.