const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const dbPath = path.join(app.getPath('userData'), 'employees.json');

function readData() {
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify([]));
  return JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
}

function writeData(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

module.exports = {
  getAll: () => readData(),

  add: ({ emp_id, name, dob, joining_date }) => {
    const data = readData();
    if (data.find(e => e.emp_id === emp_id)) throw new Error('Employee ID already exists');
    const id = Date.now();
    data.push({ id, emp_id, name, dob, joining_date });
    writeData(data);
  },

  update: ({ id, emp_id, name, dob, joining_date }) => {
    const data = readData();
    const index = data.findIndex(e => e.id === id);
    if (index === -1) throw new Error('Employee not found');
    data[index] = { id, emp_id, name, dob, joining_date };
    writeData(data);
  },

  delete: (id) => {
    const data = readData();
    writeData(data.filter(e => e.id !== id));
  },
};