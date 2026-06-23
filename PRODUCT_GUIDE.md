# StaffPing — Detailed Features & Specifications Guide

Welcome to the **StaffPing** Product Guide. This document provides a comprehensive, feature-by-feature breakdown of all capabilities, specifications, and architecture of the application.

---

## 1. Executive Summary

**StaffPing** is a premium, visual-centric desktop HR directory and milestone reminder application built for **Fusion Global Business Solutions**. It acts as an offline utility for HR teams to track employee records, monitor milestones (birthdays and work anniversaries), configure custom communication templates, and generate secure passcode-protected reports.

### Key Technology Stack:
- **Runtime Environment:** Electron.js (delivers a cross-platform desktop application)
- **Database Engine:** Node.js Native SQLite (`node:sqlite` DatabaseSync)
- **Frontend Layer:** Vanilla HTML5, CSS3 Variables (with Dark/Light theme systems), and pure JavaScript (no heavy UI frameworks)
- **Security:** AES-256-GCM database record encryption, scrypt-based backup encryption, and standard PDF user security dictionaries

---

## 2. Exhaustive List of Features (19 Features)

### 📊 1. Interactive Employee Directory Data Grid
A clean, premium grid showing full tabular details of all employees: Employee ID, Full Name, Department, Job Title, Email, Phone Number, Date of Birth, Joining Date, Service Years (computed dynamically), and Status.

### 🔍 2. Dynamic Live Omni-Search
A search bar at the top of the directory that dynamically filters records in real time as the user types. It checks across multiple fields simultaneously: Employee ID, Name, Job Title, Email, and Phone Number.

### 🎛️ 3. Advanced Directory Filtering
HR administrators can narrow down the directory using multiple filter criteria:
- **Department Filter:** Displays only employees assigned to a specific department.
- **Status Filter:** Filters the grid to show only Active profiles, Inactive profiles, or both.

### 🔢 4. Smart ID Auto-Padding
When adding or importing records, the database engine automatically detects if an Employee ID is numeric and pads it with leading zeros (e.g., `"2"` is saved as `"002"`). Alphanumeric IDs (e.g., `"EMP-001"`) are kept in their original format.

### 🗑️ 5. Bulk Database Actions
Enables HR to select multiple employees using checkboxes on the grid and perform bulk operations:
- **Bulk Delete:** Delete multiple records permanently.
- **Bulk Status Toggle:** Switch the status of all selected employees to Active or Inactive simultaneously.

### 🎊 6. Milestones Analytics Banner
A slim, glowing crimson-to-purple gradient banner at the top of the directory view ("*4 celebrations today 🎉 — click to view*") dynamically reminds HR of today's milestones. Clicking this banner instantly shifts the viewport to the calendar insights tab.

### 📅 7. Annual Milestone Calendar
A monthly grid checklist inside the *Celebrations & Insights* tab compiling all employee birthdays and anniversaries for the current calendar month, sorted by date.

### 📈 8. Departmental Headcount & Anniversary Breakdown
An analytics widget showing:
- Total headcount per department.
- Headcount percentage share of the company.
- Number of upcoming birthday and anniversary celebrations in each department.

### 🏛️ 9. Organization Tenure & Age Metrics
Calculates and displays overall company analytics:
- **Total Headcount:** Count of all registered employees.
- **Average Tenure:** Dynamically computed average years of service.
- **Age Distribution:** Visual summary of age groups across the organization.

### 🏷️ 10. Dynamic Department Pastel Tagging
Automatically assigns desaturated pastel color tags (background, border, text) matching the department's name, providing visual separation in the grid in both light and dark themes.

### 🔒 11. Passcode-Protected PDF Reports
Generates PDF directory reports. When passcode protection is selected, standard PDF encryption dictionaries (RC4 or AES-256) are applied. Open them in Chrome or Adobe Acrobat, and you will be natively prompted for the password.

### 🔐 12. Secure Database Backups & Restore
HR can manually backup the entire SQLite database (`employees.db`) to a chosen directory. Backups can be encrypted using scrypt Sync key derivation and AES-256-CBC encryption to protect stored data.

### 📦 13. CSV/XLSX Import Conflict Protection
Bulk-import engine uses SQLite `UPSERT` conflict handling to update existing profiles or insert new ones seamlessly based on their unique Employee ID.

### 🔒 14. Encrypted CSV/XLSX Import Auto-Detection
The import engine automatically checks if the selected CSV/XLSX backup is encrypted (detecting the `STAFFPING_CRYPT_` header) and prompts the user for a passcode to decrypt and parse the data on-the-fly.

### 📊 15. XLSX Workbook Spreadsheet Export
Converts the employee directory into a genuine binary Excel sheet (`.xlsx`) using SheetJS, applying optimal default column widths to ensure labels and numbers are fully readable.

### 📝 16. Customizable Notification Templates
HR can write custom message templates for birthdays and anniversaries using bracketed variables:
- `{name}` — Employee name
- `{emp_id}` — Employee ID
- `{department}` — Department name
- `{title}` — Job title
- `{years}` — Calculated milestone service tenure

### ⏰ 17. OS Native Reminders Scheduler
Runs Node.js cron logic checking daily reminders in the main process, firing standard Windows toasts at the exact target time (e.g. `09:00 AM`).

### ⚡ 18. Time-Constraint Bypass Reset
A **Reset Notification History** button in the Settings drawer clears notification logs and instantly triggers a fresh reminder check (bypassing time constraint), allowing immediate testing.

### 🌓 19. Dual-Theme Style Toggle
Allows switching between a premium Dark Slate mode and a clean Light mode, adjusting visual tokens instantly.

---

## 3. UI/UX & Design Guidelines
The application design is optimized for high visual impact and comfortable long-term usage:
- **Accents:** Vibrant Crimson/Rose `#e11d48` (dark mode) and `#be123c` (light mode).
- **Surfaces:** Dark Slate `#090d16` (background) and `#111827` (card panels).
- **Typography:** Enforces *Inter* from Google Fonts, utilizing weights `300` to `800` for strong visual hierarchy.
- **Interactive States:** Subtle transitions on hover (e.g., dropdown toggle button scales and background shifts). The dropdown hover bridge provides a seamless transition area between the menu and the button.

---

## 4. Future Enhancements

The following roadmap items represent potential feature additions to expand the utility of **StaffPing**:
- **Automatic SMTP Email & Slack Integrations:** Send milestone greetings directly to employees via corporate email servers or corporate Slack channels.
- **Active Directory & LDAP Syncing:** Synchronize employee records directly with directory servers automatically, removing the need for manual imports.
- **Dynamic Department Management:** Settings UI to visually add, delete, rename, or color-customize department tags in the main view.
- **Advanced Graphical Insights:** Embed visual charts (e.g., demographic graphs, hiring wave analytics, department charts) directly into the Insights tab.
- **Collaborative Database Sync:** Set database paths to custom shared directories (e.g. network share) to allow multiple HR admins to work off the same file.
- **Custom Milestones:** Add custom milestone triggers beyond birth dates and join dates (e.g., training dates, certifications, performance review alerts).

---

## 5. Administrative Security Notice
Database backups and export CSV/XLSX sheets encrypted via StaffPing use a custom file signature starting with `STAFFPING_CRYPT_` (16 bytes magic header) followed by a 16-byte salt, 16-byte IV, and the encrypted content. These files can be safely decrypted using the app's standard **Restore Database** or **Import CSV** utility when the appropriate passcode is provided.
