const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

router.get('/', authenticate, (req, res) => {
  const { grade_level_id } = req.query;
  const sql = grade_level_id
    ? 'SELECT * FROM classes WHERE grade_level_id=? ORDER BY name'
    : 'SELECT * FROM classes ORDER BY name';
  const rows = grade_level_id ? db.prepare(sql).all(grade_level_id) : db.prepare(sql).all();
  res.json(rows);
});

router.get('/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT * FROM classes WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Class not found' });
  res.json(row);
});

router.post('/', authenticate, (req, res) => {
  const { grade_level_id, grade_level_name, name, capacity, room, class_teacher_id, class_teacher_name } = req.body;
  if (!name) return res.status(422).json({ error: 'name required' });
  const id = uuid();
  db.prepare(`INSERT INTO classes (id,grade_level_id,grade_level_name,name,capacity,room,class_teacher_id,class_teacher_name,enrolled,created_at) VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`)
    .run(id, grade_level_id||null, grade_level_name||null, name, capacity||40, room||null, class_teacher_id||null, class_teacher_name||null, 0);
  res.status(201).json(db.prepare('SELECT * FROM classes WHERE id=?').get(id));
});

router.put('/:id', authenticate, (req, res) => {
  const { grade_level_id, grade_level_name, name, capacity, room, class_teacher_id, class_teacher_name, enrolled } = req.body;
  db.prepare(`UPDATE classes SET grade_level_id=?,grade_level_name=?,name=?,capacity=?,room=?,
    class_teacher_id=?,class_teacher_name=?,enrolled=? WHERE id=?`)
    .run(grade_level_id, grade_level_name, name, capacity, room||null,
         class_teacher_id||null, class_teacher_name||null, enrolled||0, req.params.id);
  res.json(db.prepare('SELECT * FROM classes WHERE id=?').get(req.params.id));
});

router.delete('/:id', authenticate, (req, res) => {
  db.prepare('DELETE FROM classes WHERE id=?').run(req.params.id);
  res.status(204).end();
});

// GET /api/classes/:id/students
router.get('/:id/students', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM students WHERE class_id=? AND is_active=1 ORDER BY first_name').all(req.params.id);
  res.json(rows);
});

module.exports = router;
