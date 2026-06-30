const router = require('express').Router();
const { v4: uuid } = require('uuid');
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');

const guard = [authenticate, authorize('super_admin', 'head_teacher', 'teacher')];

// GET /api/behavior?studentId=&classId=
router.get('/', ...guard, (req, res) => {
  const { studentId, classId } = req.query;
  let sql = `SELECT sb.*, s.first_name||' '||s.last_name AS student_name,
               t.first_name||' '||t.last_name AS teacher_name
             FROM student_behavior sb
             LEFT JOIN students s ON s.id = sb.student_id
             LEFT JOIN teachers t ON t.id = sb.teacher_id
             WHERE 1=1`;
  const params = [];
  if (studentId) { sql += ' AND sb.student_id=?'; params.push(studentId); }
  if (classId)   { sql += ' AND sb.class_id=?';   params.push(classId); }
  sql += ' ORDER BY sb.date DESC, sb.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/behavior
router.post('/', ...guard, (req, res) => {
  const { student_id, class_id, teacher_id, date, category, description, action_taken } = req.body;
  if (!student_id || !date || !category || !description) {
    return res.status(422).json({ error: 'student_id, date, category, description required' });
  }
  const id = uuid();
  db.prepare(`INSERT INTO student_behavior (id,student_id,class_id,teacher_id,date,category,description,action_taken,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
    .run(id, student_id, class_id || null, teacher_id || null, date, category, description, action_taken || null, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM student_behavior WHERE id=?').get(id));
});

// PUT /api/behavior/:id
router.put('/:id', ...guard, (req, res) => {
  const record = db.prepare('SELECT * FROM student_behavior WHERE id=?').get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Record not found' });
  const { date, category, description, action_taken } = req.body;
  db.prepare(`UPDATE student_behavior SET date=?,category=?,description=?,action_taken=?,updated_at=datetime('now') WHERE id=?`)
    .run(date ?? record.date, category ?? record.category, description ?? record.description, action_taken ?? record.action_taken, req.params.id);
  res.json(db.prepare('SELECT * FROM student_behavior WHERE id=?').get(req.params.id));
});

// DELETE /api/behavior/:id
router.delete('/:id', ...guard, (req, res) => {
  const record = db.prepare('SELECT * FROM student_behavior WHERE id=?').get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Record not found' });
  db.prepare('DELETE FROM student_behavior WHERE id=?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
