const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

// ── Student Attendance ──────────────────────────────────────────────

// GET /api/attendance?date=YYYY-MM-DD&classId=c1
router.get('/', authenticate, (req, res) => {
  const { date, classId, studentId, from, to } = req.query;
  let sql = 'SELECT * FROM attendance_records WHERE 1=1';
  const params = [];
  if (date)      { sql += ' AND date=?';       params.push(date); }
  if (classId)   { sql += ' AND class_id=?';   params.push(classId); }
  if (studentId) { sql += ' AND student_id=?'; params.push(studentId); }
  if (from)      { sql += ' AND date>=?';      params.push(from); }
  if (to)        { sql += ' AND date<=?';      params.push(to); }
  sql += ' ORDER BY date DESC, student_name';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/attendance  — bulk upsert for a class on a given date
router.post('/', authenticate, (req, res) => {
  const records = req.body; // [{ studentId, studentName, studentNumber, classId, className, date, status, remarks }]
  if (!Array.isArray(records)) return res.status(422).json({ error: 'Body must be an array' });

  const upsert = db.prepare(`
    INSERT INTO attendance_records (id, student_id, student_name, student_number, class_id, class_name, date, status, remarks)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(student_id, date) DO UPDATE SET status=excluded.status, remarks=excluded.remarks
  `);

  const run = db.transaction(() => records.forEach(r =>
    upsert.run(
      r.id || uuid(), r.studentId, r.studentName || null, r.studentNumber || null,
      r.classId, r.className || null, r.date, r.status, r.remarks || null
    )
  ));
  run();
  res.status(201).json({ saved: records.length });
});

// PUT /api/attendance/:id
router.put('/:id', authenticate, (req, res) => {
  const { status, remarks } = req.body;
  db.prepare('UPDATE attendance_records SET status=?,remarks=? WHERE id=?').run(status, remarks||null, req.params.id);
  res.json(db.prepare('SELECT * FROM attendance_records WHERE id=?').get(req.params.id));
});

// GET /api/attendance/stats?classId=c1&month=2025-06
router.get('/stats', authenticate, (req, res) => {
  const { classId, month } = req.query;
  if (!classId || !month) return res.status(422).json({ error: 'classId and month required' });
  const [y, m] = month.split('-');
  const from = `${y}-${m}-01`;
  const to   = `${y}-${m}-31`;
  const rows = db.prepare(`
    SELECT student_id, student_name,
      SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) as present,
      SUM(CASE WHEN status='absent'  THEN 1 ELSE 0 END) as absent,
      SUM(CASE WHEN status='late'    THEN 1 ELSE 0 END) as late,
      SUM(CASE WHEN status='excused' THEN 1 ELSE 0 END) as excused,
      COUNT(*) as total
    FROM attendance_records
    WHERE class_id=? AND date>=? AND date<=?
    GROUP BY student_id
  `).all(classId, from, to);
  res.json(rows);
});

// ── Teacher Attendance ──────────────────────────────────────────────

// GET /api/attendance/teachers?teacherId=tc1&month=2025-06
router.get('/teachers', authenticate, (req, res) => {
  const { teacherId, month, date } = req.query;
  let sql = 'SELECT ta.*, t.first_name, t.last_name FROM teacher_attendance ta JOIN teachers t ON t.id=ta.teacher_id WHERE 1=1';
  const params = [];
  if (teacherId) { sql += ' AND ta.teacher_id=?'; params.push(teacherId); }
  if (date)      { sql += ' AND ta.date=?';       params.push(date); }
  if (month)     { sql += ' AND ta.date LIKE ?';  params.push(`${month}%`); }
  sql += ' ORDER BY ta.date DESC';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/attendance/teachers
router.post('/teachers', authenticate, (req, res) => {
  const records = req.body;
  if (!Array.isArray(records)) return res.status(422).json({ error: 'Body must be an array' });
  const upsert = db.prepare(`
    INSERT INTO teacher_attendance (id, teacher_id, date, status, remarks)
    VALUES (?,?,?,?,?)
    ON CONFLICT(teacher_id, date) DO UPDATE SET status=excluded.status, remarks=excluded.remarks
  `);
  db.transaction(() => records.forEach(r =>
    upsert.run(r.id || uuid(), r.teacherId, r.date, r.status, r.remarks || null)
  ))();
  res.status(201).json({ saved: records.length });
});

module.exports = router;
