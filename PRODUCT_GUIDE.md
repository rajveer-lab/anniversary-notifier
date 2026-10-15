# StaffPing — Detailed Features & Specifications Guide

Welcome to the **StaffPing** Product Guide. This document provides a comprehensive, feature-by-feature breakdown of all capabilities, specifications, and architecture of the application.

---

## 1. Executive Summary

**StaffPing** is a premium, visual-centric desktop HR directory and milestone reminder application built for **StaffPing**. It acts as a fully offline utility for HR teams to track employee records, monitor milestones (birthdays and work anniversaries), configure custom communication templates, schedule automated daily desktop reminders, and generate secure passcode-protected reports.

### Key Technology Stack

| Layer | Technology |
|---|---|
| **Runtime** | Electron.js v42 (cross-platform desktop application) |
| **Database** | Node.js Native SQLite (`node:sqlite` — `DatabaseSync`) with WAL journaling |
| **Frontend** | Vanilla HTML5, CSS3 Custom Properties (Dark/Light theme tokens), and pure JavaScript |
| **Security** | AES-256-GCM field-level record encryption, scrypt-based backup/export encryption (AES-256-CBC), and standard PDF user-password encryption |

---

## 2. Complete Feature List (20 Features)

### 📊 1. Interactive Employee Directory Data Grid

A clean, premium data grid displaying full tabular details of all employees: Employee ID, Full Name, Department, Job Title, Email, Phone Number, Date of Birth, Joining Date, Service Years (computed dynamically), and Status (Active/Inactive).

### 🔍 2. Dynamic Live Omni-Search

A persistent search bar at the top of the directory that filters records in real time as the user types. It simultaneously searches across multiple fields: Employee ID, Name, Job Title, Email, and Phone Number — providing instant results with no submit step required.

### 🎛️ 3. Advanced Directory Filtering

HR administrators can narrow down the directory using multiple combinable filter criteria:

- **Department Filter:** Displays only employees assigned to a specific department.
- **Status Filter:** Filters the grid to show only Active profiles, Inactive profiles, or both.

Filters compose with the omni-search, so users can search within a filtered subset.

### 🔢 4. Smart ID Auto-Padding & Normalization

When adding or importing records, the database engine applies intelligent ID handling:

- **Numeric IDs** are zero-padded to a minimum of 3 digits (e.g., `"2"` → `"002"`).
- **Alphanumeric IDs** (e.g., `"EMP-001"`) are kept in their original format.
- **Case & separator normalization** — IDs are stored in uppercase and compared with hyphens, underscores, and spaces stripped, so `"EMP-001"`, `"emp 001"`, and `"EMP001"` are all treated as the same employee, preventing duplicate registrations.

### 🗑️ 5. Bulk Database Actions

Enables HR to select multiple employees using checkboxes on the grid and perform bulk operations:

- **Bulk Delete:** Permanently remove multiple records in a single action.
- **Bulk Status Toggle:** Switch the status of all selected employees to Active or Inactive simultaneously.

### 🎊 6. Milestones Analytics Banner

A slim notice at the top of the directory view (e.g., *"4 celebrations today"*), marked with a small brand-red dot. It dynamically calculates today's birthday and anniversary count and, when clicked, instantly navigates to the Celebrations & Insights tab.

### 📅 7. Annual Milestone Calendar

A monthly grid inside the *Celebrations & Insights* tab compiling all employee birthdays and work anniversaries for the current calendar month, sorted chronologically by date.

### 📈 8. Departmental Headcount & Milestone Breakdown

An analytics widget showing:

- Total headcount per department.
- Headcount percentage share of the company.
- Number of upcoming birthday and anniversary celebrations in each department.

### 🏛️ 9. Organization Tenure & Age Metrics

Calculates and displays overall company analytics:

- **Total Headcount:** Count of all registered employees.
- **Average Tenure:** Dynamically computed average years of service across the organization.
- **Age Distribution:** Visual summary of age groups across the workforce.

### 🏷️ 10. Department Management

Departments are stored once in their own `departments` table and each employee references one by foreign key. In **Settings → Departments** HR can add, rename and delete departments, each shown with its live headcount. Renaming a department onto a name that already exists (say "HR" onto "Human Resources") merges the two, and a department that still has employees cannot be deleted — the database's `ON DELETE RESTRICT` rule blocks it. The add/edit form suggests existing departments, and the directory can be filtered by department.

### 🕘 10a. Employee Change History

Opening an employee for editing shows their history: when they were added, every status, department and ID change, and each birthday or anniversary greeting sent. Changes are written by database triggers on the `employees` table, so they are recorded no matter which screen or import made them.

### 🔒 11. Passcode-Protected PDF Reports

Generates PDF directory reports rendered from the current employee data. When passcode protection is selected, standard PDF encryption dictionaries (RC4 or AES-256) are applied. Protected PDFs prompt for the user-password natively in Chrome, Adobe Acrobat, and all compliant readers.

### 🔐 12. Secure Database Backups & Restore

HR can manually backup the entire SQLite database (`employees.db`) to a chosen directory. Backups can optionally be encrypted using scrypt key derivation + AES-256-CBC, producing a self-contained encrypted file with the `STAFFPING_CRYPT_` header. The Restore flow auto-detects encrypted backups and prompts for the passcode before overwriting the live database. After a successful restore, the app performs a WAL checkpoint and re-scans for today's reminders.

### 📦 13. CSV/XLSX Import with UPSERT Conflict Protection

The bulk-import engine uses SQLite `INSERT ... ON CONFLICT DO UPDATE` (UPSERT) handling — existing profiles are updated in place based on their unique Employee ID while new profiles are inserted seamlessly, all within a single atomic transaction.

### 🔒 14. Encrypted CSV/XLSX Import Auto-Detection

The import engine automatically inspects the first 16 bytes of any selected file for the `STAFFPING_CRYPT_` magic header. If detected, the user is prompted for a passcode; the file is decrypted in-memory before being parsed. Unencrypted files are imported directly with no extra steps.

### 📊 15. XLSX Workbook Spreadsheet Export

Converts the employee directory into a genuine binary Excel workbook (`.xlsx`) using SheetJS, applying optimal default column widths for each field so that labels, IDs, dates, and phone numbers are fully readable without manual resizing. CSV export with formula-injection escaping is also supported.

### 📝 16. Customizable Notification Templates

HR can author custom message templates for birthdays and anniversaries with bracketed placeholder variables:

| Variable | Description |
|---|---|
| `{name}` | Employee full name |
| `{emp_id}` | Employee ID |
| `{department}` | Department name |
| `{title}` | Job title |
| `{years}` | Calculated milestone service tenure |
| `{email}` | Employee email address |
| `{joiningDate}` | Formatted joining date |

Separate templates are supported for birthday subject/body and anniversary subject/body.

### ⏰ 17. Daily Reminder Scheduling & OS Native Notifications

StaffPing runs a background reminder engine in the Electron main process that scans the employee database and fires **Windows toast notifications** for today's birthdays and work anniversaries. The system works as follows:

- **Configurable Reminder Time:** HR sets a daily trigger time (e.g., `09:00 AM`) in Settings. The engine will not fire notifications until the system clock reaches or exceeds this time.
- **60-Second Polling Loop:** A `setInterval` timer runs every 60 seconds, invoking the reminder check function. On each tick, the engine compares the current time against the configured reminder time and scans only if the threshold has been reached.
- **Once-a-Year Deduplication:** Every greeting is first recorded in the `notification_log` table, whose primary key is (employee, kind, year). A greeting is only sent when that insert succeeds, so the database itself guarantees at most one birthday and one anniversary greeting per employee per year, even across restarts and repeated scans.
- **Template-Driven Content:** Notification titles and bodies are populated from the customizable templates (Feature #16), with all `{placeholder}` variables resolved per-employee.
- **Inactive Employee Exclusion:** Only employees with an **Active** status receive notifications. Inactive profiles are silently skipped.
- **Startup Trigger:** On application launch, a reminder check runs immediately after the window finishes loading, ensuring that if StaffPing is opened after the configured reminder time, any pending notifications are delivered right away.
- **Event-Driven Re-scan:** The reminder engine also re-runs after any data-modifying operation (adding/editing employees, importing data, changing settings, restoring a backup) to catch newly eligible milestones without waiting for the next polling tick.

### ⚡ 18. Time-Constraint Bypass & Notification Reset

A **Reset Notification History** button in the Settings drawer deletes today's rows from `notification_log` (earlier history is kept), then instantly triggers a fresh reminder scan with the time-constraint check bypassed. This allows HR to immediately re-test or re-fire today's notifications without waiting for the scheduled time.

### 🌓 19. Dual-Theme Style Toggle

Allows instant switching between a premium **Dark Slate** mode and a clean **Light** mode. All visual tokens — surfaces, accents, borders, text colours, and interactive states — adjust immediately via CSS custom properties.

### 🔐 20. Field-Level Database Encryption (AES-256-GCM)

Personal employee fields (name, date of birth, joining date, email, job title and phone) are encrypted at rest using AES-256-GCM with a locally generated 256-bit key. The encryption key is auto-created on first launch and stored in the app's user data directory. Employee IDs, status and department stay in plain columns: they are not personal data, and keeping them readable lets SQLite enforce `CHECK` and foreign-key rules on them, index them and count them per department.

### 🗄 21. Versioned Schema Migrations & Database Health

The schema version is stored in `PRAGMA user_version`. When StaffPing opens a database from an older version — including a restored backup — it first writes a consistent copy (`employees.pre-v2.db`) with `VACUUM INTO`, then upgrades it inside a single transaction, preserving every row ID. **Settings → Data → Database status** shows the schema version, the results of SQLite's integrity and foreign-key checks, the journal mode and the row count of each table.

---

## 3. UI/UX & Design Guidelines

The interface is deliberately quiet so the data stays in front: neutral surfaces do most of the work and colour is kept for meaning.

| Token | Value |
|---|---|
| **Surfaces** | Warm neutrals — light `#f6f5f3` / `#ffffff`, dark `#131211` / `#1a1918` |
| **Primary Buttons** | Near-black ink (`#1f1d1b`) in light mode, near-white in dark mode |
| **Brand Red** | Muted brick `#a3413f` (light) / `#d98a84` (dark), used only for today's milestones, unread markers and focus rings |
| **Typography** | The native Windows UI font (Segoe UI Variable), sentence-case labels, tabular figures in tables |
| **Icons & States** | One set of outline icons; hover changes background only, with no movement or glow |

---

## 4. Future Enhancements

The following roadmap items represent potential feature additions to expand the utility of **StaffPing**:

- **Automatic SMTP Email & Slack Integrations:** Send milestone greetings directly to employees via corporate email servers or Slack channels.
- **Active Directory & LDAP Syncing:** Synchronize employee records directly with directory servers, removing the need for manual imports.
- **Advanced Graphical Insights:** Embed visual charts (demographic graphs, hiring-wave analytics, department distribution) directly into the Insights tab.
- **Collaborative Database Sync:** Set database paths to shared network directories so multiple HR admins can work from the same file.
- **Custom Milestones:** Add custom milestone triggers beyond birthdays and join dates (e.g., training dates, certifications, performance review alerts).

---

## 5. Administrative Security Notice

Database backups and exported CSV/XLSX sheets encrypted via StaffPing use a custom binary file format:

| Offset | Size | Content |
|---|---|---|
| `0x00` | 16 bytes | Magic header — `STAFFPING_CRYPT_` |
| `0x10` | 16 bytes | Random salt (scrypt key derivation) |
| `0x20` | 16 bytes | Initialization vector (AES-256-CBC) |
| `0x30` | Variable | Encrypted payload |

These files can be safely decrypted using the app's standard **Restore Database** or **Import CSV/XLSX** utility when the appropriate passcode is provided.
