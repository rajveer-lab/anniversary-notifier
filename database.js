const { DatabaseSync: Database } = require('node:sqlite');
const path = require('path');
const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');

let dbPath = path.join(app.getPath('userData'), 'employees.db');
let keyPath = path.join(app.getPath('userData'), 'db-key.enc');
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

let db = new Database(dbPath);

db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    dob TEXT,
    joining_date TEXT,
    email TEXT,
    department TEXT
  )
`);

try {
  db.exec(`ALTER TABLE employees ADD COLUMN email TEXT;`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE employees ADD COLUMN department TEXT;`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE employees ADD COLUMN job_title TEXT;`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE employees ADD COLUMN status TEXT DEFAULT 'Active';`);
} catch (e) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

// Migration: Encrypt any raw/plaintext database values on startup
function migrateExistingData() {
  const rows = db.prepare('SELECT id, emp_id, name, dob, joining_date, email, department, job_title, status FROM employees').all();
  let migrationCount = 0;
  
  db.exec('BEGIN TRANSACTION');
  try {
    const updateStmt = db.prepare(`
      UPDATE employees 
      SET name = @name, dob = @dob, joining_date = @joining_date, email = @email, department = @department, job_title = @job_title, status = @status
      WHERE id = @id
    `);
    updateStmt.setAllowBareNamedParameters(true);

    for (const row of rows) {
      let needsMigration = false;
      const updatedRow = { id: row.id };

      const fields = ['name', 'dob', 'joining_date', 'email', 'department', 'job_title', 'status'];
      for (const field of fields) {
        let val = row[field];
        if (field === 'status' && !val) {
          val = 'Active';
        }
        if (val !== undefined && val !== null && val !== '' && !String(val).startsWith('encv1:')) {
          needsMigration = true;
        }
        updatedRow[field] = encrypt(val);
      }

      if (needsMigration) {
        updateStmt.run(updatedRow);
        migrationCount++;
      }
    }
    db.exec('COMMIT');
    if (migrationCount > 0) {
      console.log(`Database Migration: Successfully encrypted ${migrationCount} existing records.`);
    }
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('Database migration failed:', e);
  }
}

migrateExistingData();

// Migration: Normalize all existing employee IDs to uppercase to prevent case-sensitivity duplicates
try {
  db.exec(`UPDATE employees SET emp_id = UPPER(TRIM(emp_id));`);
} catch (e) {
  console.warn('Migration warning: Could not normalize all employee IDs to uppercase (likely due to pre-existing duplicates):', e.message);
}

// Strip hyphens and spaces for a "canonical" uniqueness comparison
// e.g. "EMP-001", "EMP 001" and "EMP001" all normalize to "EMP001"
function normalizeId(id) {
  return String(id).trim().toUpperCase().replace(/[\s\-_]+/g, '');
}

module.exports = {

  getAll: () => {
    const rows = db.prepare('SELECT * FROM employees ORDER BY emp_id ASC').all();
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

    return rows.map(row => {
      // Decrypt all sensitive fields
      const emp = {
        id: row.id,
        emp_id: row.emp_id, // kept as plaintext
        name: decrypt(row.name),
        dob: decrypt(row.dob),
        joining_date: decrypt(row.joining_date),
        email: decrypt(row.email),
        department: decrypt(row.department),
        job_title: decrypt(row.job_title),
        status: decrypt(row.status) || 'Active'
      };

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
    // Uses UPSERT to overwrite existing records with the same emp_id to prevent crashes
    const insert = db.prepare(`
      INSERT INTO employees (emp_id, name, dob, joining_date, email, department, job_title, status)
      VALUES (@emp_id, @name, @dob, @joining_date, @email, @department, @job_title, @status)
      ON CONFLICT(emp_id) DO UPDATE SET
        name = excluded.name,
        dob = excluded.dob,
        joining_date = excluded.joining_date,
        email = excluded.email,
        department = excluded.department,
        job_title = excluded.job_title,
        status = excluded.status
    `);
    insert.setAllowBareNamedParameters(true);
    
    // Execute all insertions inside a single transaction for safety and performance
    db.exec('BEGIN TRANSACTION');
    try {
      for (const emp of employees) {
        const cleanId = emp.emp_id.trim().toUpperCase();
        const statusVal = emp.status || 'Active';
        const encryptedEmp = {
          emp_id: cleanId,
          name: encrypt(emp.name),
          dob: encrypt(emp.dob),
          joining_date: encrypt(emp.joining_date),
          email: encrypt(emp.email),
          department: encrypt(emp.department),
          job_title: encrypt(emp.job_title),
          status: encrypt(statusVal)
        };
        insert.run(encryptedEmp);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },

  add: ({ emp_id, name, dob, joining_date, email, department, job_title, status }) => {
    const cleanId = emp_id.trim().toUpperCase();
    const statusVal = status || 'Active';

    if (email && email.trim() !== '') {
      const rows = db.prepare('SELECT emp_id, email FROM employees').all();
      const duplicate = rows.find(r => decrypt(r.email) === email.trim());
      if (duplicate) {
        throw new Error(`Email address "${email.trim()}" is already assigned to employee ${duplicate.emp_id}`);
      }
    }

    // Case-insensitive + hyphen/space-insensitive uniqueness check
    const allRows = db.prepare('SELECT emp_id FROM employees').all();
    const normalNew = normalizeId(cleanId);
    const existingEmp = allRows.find(r => normalizeId(r.emp_id) === normalNew);
    if (existingEmp) {
      throw new Error(`Employee ID "${cleanId}" already exists (registered as "${existingEmp.emp_id}")`);
    }

    try {
      const stmt = db.prepare(`
        INSERT INTO employees (emp_id, name, dob, joining_date, email, department, job_title, status)
        VALUES (@emp_id, @name, @dob, @joining_date, @email, @department, @job_title, @status)
      `);
      stmt.setAllowBareNamedParameters(true);
      stmt.run({
        emp_id: cleanId,
        name: encrypt(name),
        dob: encrypt(dob),
        joining_date: encrypt(joining_date),
        email: encrypt(email),
        department: encrypt(department),
        job_title: encrypt(job_title),
        status: encrypt(statusVal)
      });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || (error.message && error.message.includes('UNIQUE constraint failed'))) {
        throw new Error(`Employee ID "${cleanId}" already exists`);
      }
      throw error;
    }
  },

  // Update by emp_id (the text ID the user controls), not the auto-increment integer
  update: ({ emp_id, original_emp_id, name, dob, joining_date, email, department, job_title, status }) => {
    const cleanId = emp_id.trim().toUpperCase();
    const cleanOrigId = original_emp_id.trim().toUpperCase();
    const statusVal = status || 'Active';

    if (email && email.trim() !== '') {
      const rows = db.prepare('SELECT emp_id, email FROM employees').all();
      const duplicate = rows.find(r => decrypt(r.email) === email.trim() && r.emp_id.trim().toUpperCase() !== cleanOrigId);
      if (duplicate) {
        throw new Error(`Email address "${email.trim()}" is already assigned to employee ${duplicate.emp_id}`);
      }
    }

    // Case-insensitive + hyphen/space-insensitive uniqueness check (excluding current employee)
    const allRows = db.prepare('SELECT emp_id FROM employees WHERE LOWER(emp_id) != LOWER(?)').all(cleanOrigId);
    const normalNew = normalizeId(cleanId);
    const existingEmp = allRows.find(r => normalizeId(r.emp_id) === normalNew);
    if (existingEmp) {
      throw new Error(`Employee ID "${cleanId}" already exists (registered as "${existingEmp.emp_id}")`);
    }

    try {
      const stmt = db.prepare(`
        UPDATE employees
        SET emp_id = @emp_id, name = @name, dob = @dob, joining_date = @joining_date, email = @email, department = @department, job_title = @job_title, status = @status
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
        department: encrypt(department),
        job_title: encrypt(job_title),
        status: encrypt(statusVal)
      });
      if (info.changes === 0) throw new Error('Employee not found');
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || (error.message && error.message.includes('UNIQUE constraint failed'))) {
        throw new Error(`Employee ID "${cleanId}" already exists`);
      }
      throw error;
    }
  },

  delete: (emp_id) => {
    db.prepare('DELETE FROM employees WHERE LOWER(emp_id) = LOWER(?)').run(emp_id.trim());
  },

  bulkDelete: (emp_ids) => {
    if (!Array.isArray(emp_ids) || emp_ids.length === 0) return;
    const stmt = db.prepare('DELETE FROM employees WHERE LOWER(emp_id) = LOWER(?)');
    db.exec('BEGIN TRANSACTION');
    try {
      for (const id of emp_ids) {
        stmt.run(id.trim());
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },

  bulkUpdateStatus: (emp_ids, status) => {
    if (!Array.isArray(emp_ids) || emp_ids.length === 0) return;
    const stmt = db.prepare('UPDATE employees SET status = ? WHERE LOWER(emp_id) = LOWER(?)');
    const encryptedStatus = encrypt(status);
    db.exec('BEGIN TRANSACTION');
    try {
      for (const id of emp_ids) {
        stmt.run(encryptedStatus, id.trim());
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },

  clearAll: () => {
    db.prepare('DELETE FROM employees').run();
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

  reopen: () => {
    try {
      db.close();
    } catch (e) {
      console.error('Failed to close database:', e);
    }
    db = new Database(dbPath);
    db.exec('PRAGMA journal_mode = WAL');
  },
};