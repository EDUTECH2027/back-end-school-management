const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const parse = row => row ? { ...row, subjects: JSON.parse(row.subjects || '[]'), isActive: !!row.is_active } : null;

// GET /api/teachers
router.get('/', authenticate, (req, res) => {
  const { search, isActive } = req.query;
  let sql = 'SELECT * FROM teachers WHERE 1=1';
  const params = [];
  if (search) { sql += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)'; const s = `%${search}%`; params.push(s,s,s); }
  if (isActive !== undefined) { sql += ' AND is_active=?'; params.push(isActive === 'true' ? 1 : 0); }
  sql += ' ORDER BY first_name';
  res.json(db.prepare(sql).all(...params).map(parse));
});

// GET /api/teachers/:id
router.get('/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT * FROM teachers WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Teacher not found' });
  res.json(parse(row));
});

// POST /api/teachers
router.post('/', authenticate, (req, res) => {
  const { firstName, lastName, email, phone, gender, subjects, classAssigned, qualification, joinDate } = req.body;
  if (!firstName || !lastName || !email) return res.status(422).json({ error: 'firstName, lastName and email required' });
  const id = uuid();
  db.prepare(`INSERT INTO teachers (id,first_name,last_name,email,phone,gender,subjects,class_assigned,qualification,join_date,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
    .run(id, firstName, lastName, email, phone||null, gender||null,
         JSON.stringify(subjects||[]), classAssigned||null, qualification||null, joinDate||null, 1);
  res.status(201).json(parse(db.prepare('SELECT * FROM teachers WHERE id=?').get(id)));
});

// PUT /api/teachers/:id
router.put('/:id', authenticate, (req, res) => {
  const { firstName, lastName, email, phone, gender, subjects, classAssigned, qualification, joinDate, isActive } = req.body;
  db.prepare(`UPDATE teachers SET first_name=?,last_name=?,email=?,phone=?,gender=?,subjects=?,
    class_assigned=?,qualification=?,join_date=?,is_active=?,updated_at=datetime('now') WHERE id=?`)
    .run(firstName, lastName, email, phone||null, gender||null,
         JSON.stringify(subjects||[]), classAssigned||null, qualification||null,
         joinDate||null, isActive !== false ? 1 : 0, req.params.id);
  res.json(parse(db.prepare('SELECT * FROM teachers WHERE id=?').get(req.params.id)));
});

// DELETE /api/teachers/:id  (soft delete)
router.delete('/:id', authenticate, (req, res) => {
  db.prepare("UPDATE teachers SET is_active=0, updated_at=datetime('now') WHERE id=?").run(req.params.id);
  res.status(204).end();
});

module.exports = router;
