const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const withChildren = (parent) => {
  if (!parent) return null;
  const children = db.prepare(`
    SELECT s.* FROM students s
    JOIN parent_students ps ON ps.student_id = s.id
    WHERE ps.parent_id = ?
  `).all(parent.id);
  return { ...parent, children };
};

router.get('/', authenticate, (req, res) => {
  const { search } = req.query;
  let sql = 'SELECT * FROM parents WHERE 1=1';
  const params = [];
  if (search) { sql += ' AND (name LIKE ? OR phone LIKE ?)'; const s = `%${search}%`; params.push(s,s); }
  sql += ' ORDER BY name';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(withChildren));
});

router.get('/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT * FROM parents WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Parent not found' });
  res.json(withChildren(row));
});

router.post('/', authenticate, (req, res) => {
  const { name, email, phone, relationship, address, occupation, studentIds = [] } = req.body;
  if (!name || !phone) return res.status(422).json({ error: 'name and phone required' });
  const id = uuid();
  db.prepare(`INSERT INTO parents (id,name,email,phone,relationship,address,occupation,created_at,updated_at) VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
    .run(id, name, email||null, phone, relationship||null, address||null, occupation||null);
  const ins = db.prepare('INSERT OR IGNORE INTO parent_students VALUES (?,?)');
  studentIds.forEach(sid => ins.run(id, sid));
  res.status(201).json(withChildren(db.prepare('SELECT * FROM parents WHERE id=?').get(id)));
});

router.put('/:id', authenticate, (req, res) => {
  const { name, email, phone, relationship, address, occupation, studentIds } = req.body;
  db.prepare(`UPDATE parents SET name=?,email=?,phone=?,relationship=?,address=?,occupation=?,updated_at=datetime('now') WHERE id=?`)
    .run(name, email||null, phone, relationship||null, address||null, occupation||null, req.params.id);
  if (Array.isArray(studentIds)) {
    db.prepare('DELETE FROM parent_students WHERE parent_id=?').run(req.params.id);
    const ins = db.prepare('INSERT OR IGNORE INTO parent_students VALUES (?,?)');
    studentIds.forEach(sid => ins.run(req.params.id, sid));
  }
  res.json(withChildren(db.prepare('SELECT * FROM parents WHERE id=?').get(req.params.id)));
});

router.delete('/:id', authenticate, (req, res) => {
  db.prepare('DELETE FROM parents WHERE id=?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
