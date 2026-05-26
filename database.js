const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

// 1. Define the database path
const dbPath = path.join(app.getPath('userData'), 'employees.db');

// 2. Initialize the database connection
const db = new Database(dbPath);

// 3. Performance Tuning: Enable Write-Ahead Logging (WAL)
// This makes reads and writes significantly faster and safer during crashes.
db.pragma('journal_mode = WAL');

// 4. Initialize Schema
// id is now managed natively by SQLite via AUTOINCREMENT
db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    dob TEXT,
    joining_date TEXT
  )
`);

module.exports = {
  // ── READ ──
  getAll: () => {
    const stmt = db.prepare('SELECT * FROM employees');
    return stmt.all(); // Returns an array of objects
  },

  // ── CREATE ──
  add: ({ emp_id, name, email, dob, joining_date }) => {
    try {
      // @ variables are securely mapped to the object keys passed to stmt.run()
      const stmt = db.prepare(`
        INSERT INTO employees (emp_id, name, email, dob, joining_date) 
        VALUES (@emp_id, @name, @email, @dob, @joining_date)
      `);
      stmt.run({ emp_id, name, email, dob, joining_date });
    } catch (error) {
      // If a user tries to add an ID that already exists, SQLite throws a unique constraint error
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error('Employee ID already exists');
      }
      throw error; 
    }
  },

  // ── UPDATE ──
  update: ({ id, emp_id, name, email, dob, joining_date }) => {
    const stmt = db.prepare(`
      UPDATE employees 
      SET emp_id = @emp_id, name = @name, email = @email, dob = @dob, joining_date = @joining_date 
      WHERE id = @id
    `);
    
    const info = stmt.run({ id, emp_id, name, email, dob, joining_date });
    
    // info.changes tells us how many rows were affected. If 0, the ID didn't exist.
    if (info.changes === 0) {
      throw new Error('Employee not found');
    }
  },

  // ── DELETE ──
  delete: (id) => {
    // ? allows us to pass a single direct variable safely
    const stmt = db.prepare('DELETE FROM employees WHERE id = ?');
    stmt.run(id);
  },
};