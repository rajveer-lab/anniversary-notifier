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
    joining_date TEXT
  )
`);

module.exports = {

  getAll: () => {
    const rows = db.prepare('SELECT * FROM employees').all();
    const today = new Date();
    const mm = today.getMonth();
    const dd = today.getDate();

    return rows.map(emp => {
      const isBirthday   = emp.dob          && (() => { const d = new Date(emp.dob);          return d.getMonth() === mm && d.getDate() === dd; })();
      const isAnniversary = emp.joining_date && (() => { const d = new Date(emp.joining_date); return d.getMonth() === mm && d.getDate() === dd; })();

      // Format dates for display: YYYY-MM-DD → DD Mon YYYY
      const fmtDate = (raw) => {
        if (!raw) return '—';
        const d = new Date(raw);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      };

      return {
        ...emp,
        dob_display:          fmtDate(emp.dob),
        joining_date_display: fmtDate(emp.joining_date),
        isBirthday:    !!isBirthday,
        isAnniversary: !!isAnniversary,
      };
    });
  },

  add: ({ emp_id, name, dob, joining_date }) => {
    try {
      db.prepare(`
        INSERT INTO employees (emp_id, name, dob, joining_date)
        VALUES (@emp_id, @name, @dob, @joining_date)
      `).run({ emp_id, name, dob, joining_date });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error(`Employee ID "${emp_id}" already exists`);
      }
      throw error;
    }
  },

  // Update by emp_id (the text ID the user controls), not the auto-increment integer
  update: ({ emp_id, original_emp_id, name, dob, joining_date }) => {
    const stmt = db.prepare(`
      UPDATE employees
      SET emp_id = @emp_id, name = @name, dob = @dob, joining_date = @joining_date
      WHERE emp_id = @original_emp_id
    `);
    const info = stmt.run({ emp_id, original_emp_id, name, dob, joining_date });
    if (info.changes === 0) throw new Error('Employee not found');
  },

  delete: (emp_id) => {
    db.prepare('DELETE FROM employees WHERE emp_id = ?').run(emp_id);
  },
};