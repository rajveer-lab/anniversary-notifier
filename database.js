const { DatabaseSync: Database } = require('node:sqlite');
const path = require('path');
const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');

const userDataDir = app.getPath('userData');
const dbPath = path.join(userDataDir, 'employees.db');
const keyPath = path.join(userDataDir, 'db-key.enc');
const legacyReminderStatePath = path.join(userDataDir, 'notif-state.json');

// Bump this and add an upgradeVxToVy step whenever the schema changes.
const SCHEMA_VERSION = 2;

let ENCRYPTION_KEY;

// Auto-generate or load key from file
if (fs.existsSync(keyPath)) {
  ENCRYPTION_KEY = fs.readFileSync(keyPath);
} else {
  ENCRYPTION_KEY = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, ENCRYPTION_KEY);
}

const ALGORITHM = 'aes-256-gcm';

function encrypt(text) {
  if (text === undefined || text === null) return null;
  const str = String(text);
  if (str === '') return '';
  if (str.startsWith('encv1:')) return str;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(str, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `encv1:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(text) {
  if (text === undefined || text === null) return null;
  const str = String(text);
  if (str === '') return '';
  if (!str.startsWith('encv1:')) return str;

  try {
    const parts = str.split(':');
    if (parts.length !== 4) return str;

    const [, ivHex, tagHex, ciphertextHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Decryption failed:', err);
    return str;
  }
}

/*
 * Schema v2.
 *
 * Only personal data (name, dates, contact details, job title) is encrypted. Status and department are not
 * personal, so they stay in plain columns where SQLite can enforce CHECK and FOREIGN KEY rules, index them and
 * aggregate them. Department names live once in `departments`; employees point at them by dept_id.
 *
 * employee_audit is written only by triggers, so every change is recorded no matter which code path made it.
 * It deliberately has no foreign key: the trail must outlive the employee it describes. It records the plain
 * columns only, because encrypted columns get a fresh IV on every save and would always look "changed".
 *
 * notification_log replaces the old notif-state.json file. Its composite primary key is what guarantees at most
 * one birthday and one anniversary greeting per employee per year.
 */
const employeesTableDDL = (name) => `
  CREATE TABLE ${name} (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_id       TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    dob          TEXT,
    joining_date TEXT,
    email        TEXT,
    job_title    TEXT,
    phone        TEXT,
    dept_id      INTEGER REFERENCES departments(dept_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    status       TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive'))
  );
`;

const SETTINGS_DDL = `
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`;

const DEPARTMENTS_DDL = `
  CREATE TABLE IF NOT EXISTS departments (
    dept_id    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(name)) > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'))
  );
`;

// Everything that depends on the final `employees` table.
const DEPENDENT_OBJECTS_DDL = `
  CREATE INDEX IF NOT EXISTS idx_employees_dept   ON employees(dept_id);
  CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);

  CREATE TABLE IF NOT EXISTS employee_audit (
    audit_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_ref    INTEGER NOT NULL,
    emp_code   TEXT NOT NULL,
    action     TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_code   TEXT,
    old_status TEXT,
    new_status TEXT,
    old_dept   TEXT,
    new_dept   TEXT,
    changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_audit_emp ON employee_audit(emp_ref, audit_id);

  CREATE TRIGGER IF NOT EXISTS trg_employees_insert AFTER INSERT ON employees
  BEGIN
    INSERT INTO employee_audit (emp_ref, emp_code, action, new_status, new_dept)
    VALUES (NEW.id, NEW.emp_id, 'INSERT', NEW.status,
            (SELECT name FROM departments WHERE dept_id = NEW.dept_id));
  END;

  CREATE TRIGGER IF NOT EXISTS trg_employees_update AFTER UPDATE OF emp_id, status, dept_id ON employees
  WHEN OLD.emp_id IS NOT NEW.emp_id OR OLD.status IS NOT NEW.status OR OLD.dept_id IS NOT NEW.dept_id
  BEGIN
    INSERT INTO employee_audit (emp_ref, emp_code, action, old_code, old_status, new_status, old_dept, new_dept)
    VALUES (NEW.id, NEW.emp_id, 'UPDATE',
            CASE WHEN OLD.emp_id IS NOT NEW.emp_id THEN OLD.emp_id END,
            OLD.status, NEW.status,
            (SELECT name FROM departments WHERE dept_id = OLD.dept_id),
            (SELECT name FROM departments WHERE dept_id = NEW.dept_id));
  END;

  CREATE TRIGGER IF NOT EXISTS trg_employees_delete AFTER DELETE ON employees
  BEGIN
    INSERT INTO employee_audit (emp_ref, emp_code, action, old_status, old_dept)
    VALUES (OLD.id, OLD.emp_id, 'DELETE', OLD.status,
            (SELECT name FROM departments WHERE dept_id = OLD.dept_id));
  END;

  CREATE TABLE IF NOT EXISTS notification_log (
    emp_ref INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    kind    TEXT NOT NULL CHECK (kind IN ('birthday', 'anniversary')),
    year    INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 9999),
    sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')),
    PRIMARY KEY (emp_ref, kind, year)
  ) WITHOUT ROWID;

  CREATE VIEW IF NOT EXISTS v_employee_directory AS
  SELECT e.id, e.emp_id, e.name, e.dob, e.joining_date, e.email, e.job_title, e.phone,
         e.status, e.dept_id, d.name AS department
  FROM employees e
  LEFT JOIN departments d ON d.dept_id = e.dept_id;

  CREATE VIEW IF NOT EXISTS v_department_summary AS
  SELECT d.dept_id,
         d.name,
         COUNT(e.id)                                      AS total,
         COUNT(CASE WHEN e.status = 'Active'   THEN 1 END) AS active,
         COUNT(CASE WHEN e.status = 'Inactive' THEN 1 END) AS inactive
  FROM departments d
  LEFT JOIN employees e ON e.dept_id = d.dept_id
  GROUP BY d.dept_id, d.name;
`;

let db;
let decryptedCache = null;

function userVersion() {
  return db.prepare('PRAGMA user_version').get().user_version;
}

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function inTransaction(work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function normalizeStatus(value) {
  return String(value ?? '').trim().toLowerCase() === 'inactive' ? 'Inactive' : 'Active';
}

function cleanDepartmentName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function localTimestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

// Strip hyphens and spaces for a "canonical" uniqueness comparison
// e.g. "EMP-001", "EMP 001" and "EMP001" all normalize to "EMP001"
function normalizeId(id) {
  return String(id).trim().toUpperCase().replace(/[\s\-_]+/g, '');
}

// ── Migrations ──────────────────────────────────────────────────────────────

// v0 → v1: the original schema grew by ALTER TABLE and stored everything encrypted. These steps bring any such
// file to the last v1 shape so the v2 rebuild only has one starting point to handle.
function upgradeToV1() {
  const columns = db.prepare('PRAGMA table_info(employees)').all().map(c => c.name);
  const added = [
    ['email', 'TEXT'], ['department', 'TEXT'], ['job_title', 'TEXT'],
    ['status', "TEXT DEFAULT 'Active'"], ['phone', 'TEXT'],
  ];
  for (const [column, type] of added) {
    if (!columns.includes(column)) db.exec(`ALTER TABLE employees ADD COLUMN ${column} ${type}`);
  }
  db.exec(SETTINGS_DDL);

  // Very old databases kept some values in plaintext.
  const fields = ['name', 'dob', 'joining_date', 'email', 'department', 'job_title', 'status', 'phone'];
  const rows = db.prepare(`SELECT id, ${fields.join(', ')} FROM employees`).all();
  const update = db.prepare(`UPDATE employees SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`);
  inTransaction(() => {
    for (const row of rows) {
      const needsWork = fields.some(f => row[f] && !String(row[f]).startsWith('encv1:'));
      if (!needsWork) continue;
      update.run(...fields.map(f => encrypt(f === 'status' && !row[f] ? 'Active' : row[f])), row.id);
    }
  });

  try {
    db.exec('UPDATE employees SET emp_id = UPPER(TRIM(emp_id))');
  } catch (e) {
    console.warn('[db] Could not upper-case every employee ID (duplicates?):', e.message);
  }
  db.exec('PRAGMA user_version = 1');
}

// Consistent copy of the database taken before a destructive migration. VACUUM INTO cannot run inside a
// transaction, which is why this happens before the rebuild starts.
function backupBeforeMigration(label) {
  let target = path.join(userDataDir, `employees.pre-${label}.db`);
  if (fs.existsSync(target)) {
    target = path.join(userDataDir, `employees.pre-${label}-${Date.now()}.db`);
  }
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  console.log(`[db] Pre-migration copy written to ${target}`);
  return target;
}

// Carry over today's "already greeted" markers so the upgrade does not send the same greetings twice.
function importLegacyReminderState() {
  if (!fs.existsSync(legacyReminderStatePath)) return 0;
  let state;
  try {
    state = JSON.parse(fs.readFileSync(legacyReminderStatePath, 'utf8'));
  } catch {
    return 0;
  }
  if (!state || state.date !== new Date().toDateString() || !state.notifications) return 0;

  const findEmployee = db.prepare('SELECT id FROM employees WHERE emp_id = ?');
  const log = db.prepare(`
    INSERT INTO notification_log (emp_ref, kind, year, sent_at) VALUES (?, ?, ?, ?)
    ON CONFLICT DO NOTHING
  `);
  let imported = 0;
  for (const [key, entry] of Object.entries(state.notifications)) {
    const match = /^(bday|anniv)-(.+)$/.exec(key);
    if (!match || !entry || !entry.handled) continue;
    const emp = findEmployee.get(match[2].trim().toUpperCase());
    if (!emp) continue;
    const sentAt = localTimestamp(new Date(entry.timestamp || Date.now()));
    imported += log.run(emp.id, match[1] === 'bday' ? 'birthday' : 'anniversary', new Date().getFullYear(), sentAt).changes;
  }
  return imported;
}

// v1 → v2: SQLite cannot add CHECK or FOREIGN KEY constraints to existing columns, so `employees` is rebuilt
// (create new table, copy, drop old, rename), following SQLite's documented procedure for schema changes.
function upgradeToV2() {
  backupBeforeMigration('v2');

  const legacyRows = db.prepare('SELECT * FROM employees ORDER BY id').all();
  const oldSequence = tableExists('sqlite_sequence')
    ? (db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'employees'").get() || {}).seq || 0
    : 0;

  db.exec('PRAGMA foreign_keys = OFF');
  let remindersImported = 0;
  try {
    inTransaction(() => {
      db.exec(DEPARTMENTS_DDL);
      db.exec(employeesTableDDL('employees_v2'));

      const addDept = db.prepare('INSERT INTO departments (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
      const findDept = db.prepare('SELECT dept_id FROM departments WHERE name = ?');
      const copy = db.prepare(`
        INSERT INTO employees_v2 (id, emp_id, name, dob, joining_date, email, job_title, phone, dept_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const row of legacyRows) {
        const deptName = cleanDepartmentName(decrypt(row.department));
        let deptId = null;
        if (deptName) {
          addDept.run(deptName);
          deptId = findDept.get(deptName).dept_id;
        }
        // Encrypted personal columns are copied as ciphertext; only status and department are decrypted.
        copy.run(row.id, row.emp_id, row.name ?? '', row.dob, row.joining_date, row.email, row.job_title,
          row.phone, deptId, normalizeStatus(decrypt(row.status)));
      }

      db.exec('DROP TABLE employees');
      db.exec('ALTER TABLE employees_v2 RENAME TO employees');
      // Keep AUTOINCREMENT's high-water mark so IDs of deleted employees are never handed out again;
      // the audit trail refers to employees by that ID.
      const highest = Math.max(oldSequence, ...legacyRows.map(r => r.id), 0);
      db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('employees', 'employees_v2')").run();
      db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('employees', ?)").run(highest);

      db.exec(DEPENDENT_OBJECTS_DDL);
      remindersImported = importLegacyReminderState();
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }

  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) console.warn('[db] Foreign key check after migration found', violations.length, 'problems');
  if (fs.existsSync(legacyReminderStatePath)) {
    try { fs.unlinkSync(legacyReminderStatePath); } catch { /* the file is no longer read, so leaving it is harmless */ }
  }
  console.log(`[db] Migrated ${legacyRows.length} employees to schema v${SCHEMA_VERSION} (${remindersImported} reminder markers kept)`);
}

function migrate() {
  if (userVersion() === 0 && !tableExists('employees')) {
    inTransaction(() => {
      db.exec(SETTINGS_DDL);
      db.exec(DEPARTMENTS_DDL);
      db.exec(employeesTableDDL('employees'));
      db.exec(DEPENDENT_OBJECTS_DDL);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
    return;
  }
  if (userVersion() < 1) upgradeToV1();
  if (userVersion() < 2) upgradeToV2();
}

function openDatabase() {
  db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  // SQLite ships with foreign keys off for backwards compatibility; they must be enabled on every connection.
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 3000');
  migrate();
}

openDatabase();

// Looks up a department by name (case-insensitive via the column's NOCASE collation), creating it if needed.
function departmentIdFor(name) {
  const clean = cleanDepartmentName(name);
  if (!clean) return null;
  db.prepare('INSERT INTO departments (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(clean);
  return db.prepare('SELECT dept_id FROM departments WHERE name = ?').get(clean).dept_id;
}

function isUniqueViolation(error) {
  return error.code === 'SQLITE_CONSTRAINT_UNIQUE' || (error.message && error.message.includes('UNIQUE constraint failed'));
}

function findDuplicateEmail(email, exceptEmpId = null) {
  if (!email || email.trim() === '') return null;
  // Email is encrypted with a random IV, so equality can only be checked after decryption.
  const rows = db.prepare('SELECT emp_id, email FROM employees').all();
  return rows.find(r => decrypt(r.email) === email.trim() && r.emp_id !== exceptEmpId) || null;
}

module.exports = {

  getAll: () => {
    const today = new Date();
    const mm = today.getMonth();
    const dd = today.getDate();

    // Helper to safely parse YYYY-MM-DD to a local date object
    // This prevents the JS UTC timezone bug that shifts dates back by 1 day
    const parseLocalDate = (raw) => {
      if (!raw) return null;
      const parts = raw.split('-');
      if (parts.length !== 3) return null;
      const year  = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const day   = parseInt(parts[2], 10);
      if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
      return new Date(year, month - 1, day);
    };

    if (!decryptedCache) {
      const rows = db.prepare('SELECT * FROM v_employee_directory ORDER BY emp_id ASC').all();
      decryptedCache = rows.map(row => ({
        id: row.id,
        emp_id: row.emp_id,
        name: decrypt(row.name),
        dob: decrypt(row.dob),
        joining_date: decrypt(row.joining_date),
        email: decrypt(row.email),
        department: row.department || '',
        dept_id: row.dept_id,
        job_title: decrypt(row.job_title),
        status: row.status,
        phone: decrypt(row.phone)
      }));
    }

    return decryptedCache.map(emp => {
      let isBirthday = false;
      let isAnniversary = false;

      const dobDate = parseLocalDate(emp.dob);
      if (dobDate && dobDate.getMonth() === mm && dobDate.getDate() === dd) {
        isBirthday = true;
      }

      const joinDate = parseLocalDate(emp.joining_date);
      if (joinDate && joinDate.getMonth() === mm && joinDate.getDate() === dd) {
        isAnniversary = true;
      }

      const fmtDate = (d) => {
        if (!d) return '—';
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      };

      // Calculate service years dynamically
      let service_display = '—';
      if (joinDate) {
        let years = today.getFullYear() - joinDate.getFullYear();
        const mDiff = today.getMonth() - joinDate.getMonth();
        if (mDiff < 0 || (mDiff === 0 && today.getDate() < joinDate.getDate())) {
          years--;
        }
        if (years >= 0) {
          service_display = `${years} Yr${years !== 1 ? 's' : ''}`;
        }
      }

      return {
        ...emp,
        dob_display: fmtDate(dobDate),
        joining_date_display: fmtDate(joinDate),
        isBirthday,
        isAnniversary,
        service_display,
      };
    });
  },

  importData: (employees) => {
    decryptedCache = null;
    // UPSERT: an existing emp_id is updated in place, so re-importing a file never duplicates anyone.
    // Updates fire trg_employees_update, so imported status/department changes show up in each history.
    const upsert = db.prepare(`
      INSERT INTO employees (emp_id, name, dob, joining_date, email, job_title, phone, dept_id, status)
      VALUES (@emp_id, @name, @dob, @joining_date, @email, @job_title, @phone, @dept_id, @status)
      ON CONFLICT(emp_id) DO UPDATE SET
        name = excluded.name,
        dob = excluded.dob,
        joining_date = excluded.joining_date,
        email = excluded.email,
        job_title = excluded.job_title,
        phone = excluded.phone,
        dept_id = excluded.dept_id,
        status = excluded.status
    `);
    upsert.setAllowBareNamedParameters(true);

    const deptCache = new Map();
    inTransaction(() => {
      for (const emp of employees) {
        const deptName = cleanDepartmentName(emp.department);
        const key = deptName.toLowerCase();
        if (!deptCache.has(key)) deptCache.set(key, departmentIdFor(deptName));

        upsert.run({
          emp_id: emp.emp_id.trim().toUpperCase(),
          name: encrypt(emp.name),
          dob: encrypt(emp.dob),
          joining_date: encrypt(emp.joining_date),
          email: encrypt(emp.email),
          job_title: encrypt(emp.job_title),
          phone: encrypt(emp.phone),
          dept_id: deptCache.get(key),
          status: normalizeStatus(emp.status)
        });
      }
    });
  },

  add: ({ emp_id, name, dob, joining_date, email, department, job_title, status, phone }) => {
    decryptedCache = null;
    const cleanId = emp_id.trim().toUpperCase();

    const duplicate = findDuplicateEmail(email);
    if (duplicate) {
      throw new Error(`Email address "${email.trim()}" is already assigned to employee ${duplicate.emp_id}`);
    }

    // Case-insensitive + hyphen/space-insensitive uniqueness check
    const allRows = db.prepare('SELECT emp_id FROM employees').all();
    const normalNew = normalizeId(cleanId);
    const existingEmp = allRows.find(r => normalizeId(r.emp_id) === normalNew);
    if (existingEmp) {
      throw new Error(`Employee ID "${cleanId}" already exists (registered as "${existingEmp.emp_id}")`);
    }

    try {
      // The department row and the employee row are created together or not at all.
      inTransaction(() => {
        const stmt = db.prepare(`
          INSERT INTO employees (emp_id, name, dob, joining_date, email, job_title, phone, dept_id, status)
          VALUES (@emp_id, @name, @dob, @joining_date, @email, @job_title, @phone, @dept_id, @status)
        `);
        stmt.setAllowBareNamedParameters(true);
        stmt.run({
          emp_id: cleanId,
          name: encrypt(name),
          dob: encrypt(dob),
          joining_date: encrypt(joining_date),
          email: encrypt(email),
          job_title: encrypt(job_title),
          phone: encrypt(phone),
          dept_id: departmentIdFor(department),
          status: normalizeStatus(status)
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(`Employee ID "${cleanId}" already exists`);
      throw error;
    }
  },

  // Update by emp_id (the text ID the user controls), not the auto-increment integer
  update: ({ emp_id, original_emp_id, name, dob, joining_date, email, department, job_title, status, phone }) => {
    decryptedCache = null;
    const cleanId = emp_id.trim().toUpperCase();
    const cleanOrigId = original_emp_id.trim().toUpperCase();

    const duplicate = findDuplicateEmail(email, cleanOrigId);
    if (duplicate) {
      throw new Error(`Email address "${email.trim()}" is already assigned to employee ${duplicate.emp_id}`);
    }

    // Case-insensitive + hyphen/space-insensitive uniqueness check (excluding current employee)
    const allRows = db.prepare('SELECT emp_id FROM employees WHERE emp_id != ?').all(cleanOrigId);
    const normalNew = normalizeId(cleanId);
    const existingEmp = allRows.find(r => normalizeId(r.emp_id) === normalNew);
    if (existingEmp) {
      throw new Error(`Employee ID "${cleanId}" already exists (registered as "${existingEmp.emp_id}")`);
    }

    try {
      inTransaction(() => {
        const stmt = db.prepare(`
          UPDATE employees
          SET emp_id = @emp_id, name = @name, dob = @dob, joining_date = @joining_date, email = @email,
              job_title = @job_title, phone = @phone, dept_id = @dept_id, status = @status
          WHERE emp_id = @original_emp_id
        `);
        stmt.setAllowBareNamedParameters(true);
        const info = stmt.run({
          emp_id: cleanId,
          original_emp_id: cleanOrigId,
          name: encrypt(name),
          dob: encrypt(dob),
          joining_date: encrypt(joining_date),
          email: encrypt(email),
          job_title: encrypt(job_title),
          phone: encrypt(phone),
          dept_id: departmentIdFor(department),
          status: normalizeStatus(status)
        });
        if (info.changes === 0) throw new Error('Employee not found');
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(`Employee ID "${cleanId}" already exists`);
      throw error;
    }
  },

  delete: (emp_id) => {
    decryptedCache = null;
    db.prepare('DELETE FROM employees WHERE emp_id = ?').run(emp_id.trim().toUpperCase());
  },

  bulkDelete: (emp_ids) => {
    decryptedCache = null;
    if (!Array.isArray(emp_ids) || emp_ids.length === 0) return;
    const stmt = db.prepare('DELETE FROM employees WHERE emp_id = ?');
    inTransaction(() => {
      for (const id of emp_ids) stmt.run(id.trim().toUpperCase());
    });
  },

  bulkUpdateStatus: (emp_ids, status) => {
    decryptedCache = null;
    if (!Array.isArray(emp_ids) || emp_ids.length === 0) return;
    const stmt = db.prepare('UPDATE employees SET status = ? WHERE emp_id = ?');
    const value = normalizeStatus(status);
    inTransaction(() => {
      for (const id of emp_ids) stmt.run(value, id.trim().toUpperCase());
    });
  },

  clearAll: () => {
    decryptedCache = null;
    // Departments are reference data and are kept; reminder log rows go with their employees (ON DELETE CASCADE).
    db.prepare('DELETE FROM employees').run();
  },

  // ── Departments ──

  listDepartments: () => {
    const rows = db.prepare('SELECT dept_id, name, total, active, inactive FROM v_department_summary ORDER BY name COLLATE NOCASE').all();
    const unassigned = db.prepare(`
      SELECT COUNT(*) AS total,
             COUNT(CASE WHEN status = 'Active' THEN 1 END) AS active,
             COUNT(CASE WHEN status = 'Inactive' THEN 1 END) AS inactive
      FROM employees WHERE dept_id IS NULL
    `).get();
    return { departments: rows, unassigned };
  },

  addDepartment: (name) => {
    const clean = cleanDepartmentName(name);
    if (!clean) throw new Error('Department name cannot be empty');
    try {
      db.prepare('INSERT INTO departments (name) VALUES (?)').run(clean);
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(`A department called "${clean}" already exists`);
      throw error;
    }
  },

  // Renaming onto an existing name (say "HR" onto "Human Resources") merges the two departments.
  renameDepartment: (deptId, newName) => {
    decryptedCache = null;
    const clean = cleanDepartmentName(newName);
    if (!clean) throw new Error('Department name cannot be empty');
    return inTransaction(() => {
      const current = db.prepare('SELECT dept_id, name FROM departments WHERE dept_id = ?').get(deptId);
      if (!current) throw new Error('Department not found');
      const target = db.prepare('SELECT dept_id, name FROM departments WHERE name = ?').get(clean);
      if (target && target.dept_id !== current.dept_id) {
        const moved = db.prepare('UPDATE employees SET dept_id = ? WHERE dept_id = ?').run(target.dept_id, current.dept_id).changes;
        db.prepare('DELETE FROM departments WHERE dept_id = ?').run(current.dept_id);
        return { merged: true, into: target.name, moved };
      }
      db.prepare('UPDATE departments SET name = ? WHERE dept_id = ?').run(clean, current.dept_id);
      return { merged: false, into: clean, moved: 0 };
    });
  },

  // ON DELETE RESTRICT does the actual protecting; this only turns the error into a readable message.
  deleteDepartment: (deptId) => {
    try {
      const info = db.prepare('DELETE FROM departments WHERE dept_id = ?').run(deptId);
      if (info.changes === 0) throw new Error('Department not found');
    } catch (error) {
      if (error.message && error.message.includes('FOREIGN KEY constraint failed')) {
        const { name } = db.prepare('SELECT name FROM departments WHERE dept_id = ?').get(deptId);
        const { n } = db.prepare('SELECT COUNT(*) AS n FROM employees WHERE dept_id = ?').get(deptId);
        throw new Error(`"${name}" still has ${n} employee${n === 1 ? '' : 's'}. Move them to another department first.`);
      }
      throw error;
    }
  },

  // ── History and reminders ──

  getHistory: (emp_id) => {
    const emp = db.prepare('SELECT id FROM employees WHERE emp_id = ?').get(String(emp_id).trim().toUpperCase());
    if (!emp) return [];
    return db.prepare(`
      SELECT 'change' AS source, audit_id AS seq, action, emp_code, old_code, old_status, new_status,
             old_dept, new_dept, NULL AS kind, NULL AS year, changed_at AS at
      FROM employee_audit WHERE emp_ref = ?
      UNION ALL
      SELECT 'reminder', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, kind, year, sent_at
      FROM notification_log WHERE emp_ref = ?
      ORDER BY at DESC, seq DESC
    `).all(emp.id, emp.id);
  },

  // Returns true only for the first call per employee, kind and year: the primary key turns the second INSERT
  // into a no-op, so a greeting cannot be sent twice even if the reminder check runs again.
  claimReminder: (empRef, kind, year, when = new Date()) => {
    const info = db.prepare(`
      INSERT INTO notification_log (emp_ref, kind, year, sent_at) VALUES (?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(empRef, kind, year, localTimestamp(when));
    return info.changes === 1;
  },

  // Forget the reminders logged on one day (YYYY-MM-DD) so they can fire again; earlier history is kept.
  clearRemindersOn: (day) => {
    return db.prepare('DELETE FROM notification_log WHERE substr(sent_at, 1, 10) = ?').run(day).changes;
  },

  getDatabaseInfo: () => {
    const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    const objects = db.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `).all();
    const backups = fs.readdirSync(userDataDir).filter(f => /^employees\.pre-.+\.db$/.test(f));
    return {
      schemaVersion: userVersion(),
      journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode,
      foreignKeys: db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1,
      integrity: db.prepare('PRAGMA quick_check').get().quick_check,
      foreignKeyViolations: db.prepare('PRAGMA foreign_key_check').all().length,
      rows: {
        employees: count('employees'),
        departments: count('departments'),
        employee_audit: count('employee_audit'),
        notification_log: count('notification_log'),
      },
      objects,
      fileBytes: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
      preMigrationBackups: backups,
    };
  },

  getSetting: (key) => {
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return row ? row.value : null;
    } catch (e) {
      console.error('Failed to get setting:', e);
      return null;
    }
  },

  saveSetting: (key, value) => {
    try {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
      return true;
    } catch (e) {
      console.error('Failed to save setting:', e);
      throw e;
    }
  },

  close: () => {
    try {
      db.close();
    } catch (e) {
      console.error('Failed to close database:', e);
    }
  },

  checkpoint: () => {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (e) {
      console.error('Failed to checkpoint database:', e);
    }
  },

  // Used after a restore: the restored file may be an older schema, so it goes through the same migrations.
  reopen: () => {
    decryptedCache = null;
    try {
      db.close();
    } catch (e) {
      // ignore
    }
    openDatabase();
  },
};
