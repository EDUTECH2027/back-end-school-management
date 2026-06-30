const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

// GET /api/timetable?teacherId=tc1&classId=c1&day=monday
router.get('/', authenticate, (req, res) => {
  const { teacherId, classId, day } = req.query;
  let sql = `SELECT ts.*, t.first_name, t.last_name FROM teacher_schedule ts
             LEFT JOIN teachers t ON t.id = ts.teacher_id WHERE 1=1`;
  const params = [];
  if (teacherId) { sql += ' AND ts.teacher_id=?'; params.push(teacherId); }
  if (classId)   { sql += ' AND ts.class_id=?';   params.push(classId); }
  if (day)       { sql += ' AND ts.day=?';         params.push(day); }
  sql += " ORDER BY CASE ts.day WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2 WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 ELSE 5 END, ts.period_key";
  res.json(db.prepare(sql).all(...params));
});

// POST /api/timetable
router.post('/', authenticate, (req, res) => {
  const { teacherId, day, periodKey, periodLabel, time, classId, className, subjectName, room } = req.body;
  if (!day || !periodKey || !classId || !subjectName) return res.status(422).json({ error: 'Missing required fields' });
  const id = uuid();
  db.prepare('INSERT INTO teacher_schedule (id,teacher_id,day,period_key,period_label,time,class_id,class_name,subject_name,room) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, teacherId||null, day, periodKey, periodLabel||null, time||null, classId, className||null, subjectName, room||null);
  res.status(201).json(db.prepare('SELECT ts.*, t.first_name, t.last_name FROM teacher_schedule ts LEFT JOIN teachers t ON t.id=ts.teacher_id WHERE ts.id=?').get(id));
});

// PUT /api/timetable/:id
router.put('/:id', authenticate, (req, res) => {
  const { teacherId, day, periodKey, periodLabel, time, classId, className, subjectName, room } = req.body;
  db.prepare('UPDATE teacher_schedule SET teacher_id=?,day=?,period_key=?,period_label=?,time=?,class_id=?,class_name=?,subject_name=?,room=? WHERE id=?')
    .run(teacherId, day, periodKey, periodLabel||null, time||null, classId, className||null, subjectName, room||null, req.params.id);
  res.json(db.prepare('SELECT * FROM teacher_schedule WHERE id=?').get(req.params.id));
});

// DELETE /api/timetable/:id
router.delete('/:id', authenticate, (req, res) => {
  db.prepare('DELETE FROM teacher_schedule WHERE id=?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
