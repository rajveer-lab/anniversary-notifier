const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

const dbPath = path.join(app.getPath('userData'), 'employees.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    dob TEXT,
    joining_date TEXT,
    email TEXT
  )
`);

try {
  db.exec(`ALTER TABLE employees ADD COLUMN email TEXT;`);
} catch (e) {
  // Ignored if column already exists or table was just created with it
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
      const [year, month, day] = raw.split('-');
      return new Date(year, month - 1, day);
    };

    return rows.map(emp => {
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

      return {
        ...emp,
        dob_display: fmtDate(dobDate),
        joining_date_display: fmtDate(joinDate),
        isBirthday,
        isAnniversary,
      };
    });
  },

  importData: (employees) => {
    // Uses UPSERT to overwrite existing records with the same emp_id to prevent crashes
    const insert = db.prepare(`
      INSERT INTO employees (emp_id, name, dob, joining_date, email)
      VALUES (@emp_id, @name, @dob, @joining_date, @email)
      ON CONFLICT(emp_id) DO UPDATE SET
        name = excluded.name,
        dob = excluded.dob,
        joining_date = excluded.joining_date,
        email = excluded.email
    `);
    
    // Execute all insertions inside a single transaction for safety and performance
    const transaction = db.transaction((emps) => {
      for (const emp of emps) {
        insert.run(emp);
      }
    });
    
    transaction(employees);
  },

  add: ({ emp_id, name, dob, joining_date, email }) => {
    try {
      db.prepare(`
        INSERT INTO employees (emp_id, name, dob, joining_date, email)
        VALUES (@emp_id, @name, @dob, @joining_date, @email)
      `).run({ emp_id, name, dob, joining_date, email });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error(`Employee ID "${emp_id}" already exists`);
      }
      throw error;
    }
  },

  // Update by emp_id (the text ID the user controls), not the auto-increment integer
  update: ({ emp_id, original_emp_id, name, dob, joining_date, email }) => {
    const stmt = db.prepare(`
      UPDATE employees
      SET emp_id = @emp_id, name = @name, dob = @dob, joining_date = @joining_date, email = @email
      WHERE emp_id = @original_emp_id
    `);
    const info = stmt.run({ emp_id, original_emp_id, name, dob, joining_date, email });
    if (info.changes === 0) throw new Error('Employee not found');
  },

  delete: (emp_id) => {
    db.prepare('DELETE FROM employees WHERE emp_id = ?').run(emp_id);
  },

  clearAll: () => {
    db.prepare('DELETE FROM employees').run();
  },
};