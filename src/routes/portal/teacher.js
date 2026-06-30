const router = require('express').Router();
const { v4: uuid } = require('uuid');
const db = require('../../db/database');
const authenticate = require('../../middleware/auth');
const authorize = require('../../middleware/authorize');

const guard = [authenticate, authorize('teacher', 'head_teacher', 'super_admin')];
const tid = req => req.user.teacher_id;

// GET /api/portal/teacher/profile
router.get('/profile', ...guard, (req, res) => {
  const t = db.prepare('SELECT * FROM teachers WHERE id=?').get(tid(req));
  if (!t) return res.status(404).json({ error: 'Teacher profile not found' });
  res.json(t);
});

// PUT /api/portal/teacher/profile  (limited fields only)
router.put('/profile', ...guard, (req, res) => {
  const { phone, qualification } = req.body;
  db.prepare("UPDATE teachers SET phone=?,qualification=?,updated_at=datetime('now') WHERE id=?")
    .run(phone ?? null, qualification ?? null, tid(req));
  res.json(db.prepare('SELECT * FROM teachers WHERE id=?').get(tid(req)));
});

// GET /api/portal/teacher/classes
router.get('/classes', ...guard, (req, res) => {
  const classes = db.prepare('SELECT * FROM classes WHERE class_teacher_id=?').all(tid(req));
  res.json(classes);
});

// GET /api/portal/teacher/timetable
router.get('/timetable', ...guard, (req, res) => {
  const rows = db.prepare(`SELECT ts.*, c.name AS class_name FROM teacher_schedule ts
    LEFT JOIN classes c ON c.id=ts.class_id WHERE ts.teacher_id=?
    ORDER BY CASE ts.day WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2 WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 ELSE 5 END, ts.period_key`
  ).all(tid(req));
  res.json(rows);
});

// GET /api/portal/teacher/my-attendance?month=2025-06
router.get('/my-attendance', ...guard, (req, res) => {
  const { month } = req.query;
  let sql = 'SELECT * FROM teacher_attendance WHERE teacher_id=?';
  const params = [tid(req)];
  if (month) { sql += ' AND date LIKE ?'; params.push(`${month}%`); }
  sql += ' ORDER BY date DESC';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/portal/teacher/my-attendance  (report own absence)
router.post('/my-attendance', ...guard, (req, res) => {
  const { date, status, remarks } = req.body;
  if (!date || !status) return res.status(422).json({ error: 'date and status required' });
  const id = uuid();
  try {
    db.prepare('INSERT INTO teacher_attendance (id,teacher_id,date,status,remarks) VALUES (?,?,?,?,?)')
      .run(id, tid(req), date, status, remarks || null);
  } catch (_) {
    db.prepare('UPDATE teacher_attendance SET status=?,remarks=? WHERE teacher_id=? AND date=?')
      .run(status, remarks || null, tid(req), date);
  }
  res.status(201).json(db.prepare('SELECT * FROM teacher_attendance WHERE teacher_id=? AND date=?').get(tid(req), date));
});

// GET /api/portal/teacher/marks?classId=&termId=
router.get('/marks', ...guard, (req, res) => {
  const { classId, termId } = req.query;
  if (!classId || !termId) return res.status(422).json({ error: 'classId and termId required' });
  const ownClass = db.prepare('SELECT id FROM classes WHERE id=? AND class_teacher_id=?').get(classId, tid(req));
  if (!ownClass) return res.status(403).json({ error: 'Not your class' });
  res.json(db.prepare('SELECT * FROM marks WHERE class_id=? AND term_id=? ORDER BY student_name, subject_name').all(classId, termId));
});

// POST /api/portal/teacher/marks  (bulk upsert)
router.post('/marks', ...guard, (req, res) => {
  const { classId, termId, marks } = req.body;
  if (!classId || !termId || !Array.isArray(marks)) return res.status(422).json({ error: 'classId, termId, marks[] required' });
  const ownClass = db.prepare('SELECT id FROM classes WHERE id=? AND class_teacher_id=?').get(classId, tid(req));
  if (!ownClass) return res.status(403).json({ error: 'Not your class' });

  const upsert = db.transaction(() => {
    for (const m of marks) {
      const existing = db.prepare('SELECT id FROM marks WHERE student_id=? AND subject_id=? AND term_id=?').get(m.student_id, m.subject_id, termId);
      const total = (m.ca_score || 0) + (m.exam_score || 0);
      if (existing) {
        db.prepare(`UPDATE marks SET ca_score=?,exam_score=?,total_score=?,grade=?,remark=?,updated_at=datetime('now') WHERE id=?`)
          .run(m.ca_score ?? 0, m.exam_score ?? 0, total, m.grade || null, m.remark || null, existing.id);
      } else {
        db.prepare(`INSERT INTO marks (id,student_id,student_name,student_number,subject_id,subject_name,term_id,class_id,ca_score,exam_score,total_score,grade,remark,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
          .run(uuid(), m.student_id, m.student_name || null, m.student_number || null,
               m.subject_id, m.subject_name || null, termId, classId,
               m.ca_score ?? 0, m.exam_score ?? 0, total, m.grade || null, m.remark || null);
      }
    }
  });
  upsert();
  res.json({ saved: marks.length });
});

// GET /api/portal/teacher/student-attendance?classId=&date=
router.get('/student-attendance', ...guard, (req, res) => {
  const { classId, date } = req.query;
  if (!classId) return res.status(422).json({ error: 'classId required' });
  const ownClass = db.prepare('SELECT id FROM classes WHERE id=? AND class_teacher_id=?').get(classId, tid(req));
  if (!ownClass) return res.status(403).json({ error: 'Not your class' });
  let sql = 'SELECT * FROM attendance_records WHERE class_id=?';
  const params = [classId];
  if (date) { sql += ' AND date=?'; params.push(date); }
  sql += ' ORDER BY student_name';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/portal/teacher/student-attendance  (bulk save)
router.post('/student-attendance', ...guard, (req, res) => {
  const { classId, date, records } = req.body;
  if (!classId || !date || !Array.isArray(records)) return res.status(422).json({ error: 'classId, date, records[] required' });
  const ownClass = db.prepare('SELECT id FROM classes WHERE id=? AND class_teacher_id=?').get(classId, tid(req));
  if (!ownClass) return res.status(403).json({ error: 'Not your class' });

  const save = db.transaction(() => {
    for (const r of records) {
      const existing = db.prepare('SELECT id FROM attendance_records WHERE student_id=? AND date=?').get(r.student_id, date);
      if (existing) {
        db.prepare('UPDATE attendance_records SET status=?,remarks=? WHERE id=?').run(r.status, r.remarks || null, existing.id);
      } else {
        db.prepare(`INSERT INTO attendance_records (id,student_id,student_name,student_number,class_id,class_name,date,status,remarks,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`)
          .run(uuid(), r.student_id, r.student_name || null, r.student_number || null,
               classId, r.class_name || null, date, r.status, r.remarks || null);
      }
    }
  });
  save();
  res.json({ saved: records.length });
});

// GET /api/portal/teacher/behavior?classId=
router.get('/behavior', ...guard, (req, res) => {
  const { classId } = req.query;
  const ownClass = classId ? db.prepare('SELECT id FROM classes WHERE id=? AND class_teacher_id=?').get(classId, tid(req)) : null;
  if (classId && !ownClass) return res.status(403).json({ error: 'Not your class' });
  let sql = `SELECT sb.*, s.first_name||' '||s.last_name AS student_name FROM student_behavior sb
    LEFT JOIN students s ON s.id=sb.student_id WHERE sb.teacher_id=?`;
  const params = [tid(req)];
  if (classId) { sql += ' AND sb.class_id=?'; params.push(classId); }
  sql += ' ORDER BY sb.date DESC';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/portal/teacher/behavior
router.post('/behavior', ...guard, (req, res) => {
  const { student_id, class_id, date, category, description, action_taken } = req.body;
  if (!student_id || !date || !category || !description) return res.status(422).json({ error: 'student_id, date, category, description required' });
  const id = uuid();
  db.prepare(`INSERT INTO student_behavior (id,student_id,class_id,teacher_id,date,category,description,action_taken,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
    .run(id, student_id, class_id || null, tid(req), date, category, description, action_taken || null, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM student_behavior WHERE id=?').get(id));
});

// PUT /api/portal/teacher/behavior/:id
router.put('/behavior/:id', ...guard, (req, res) => {
  const record = db.prepare('SELECT * FROM student_behavior WHERE id=? AND teacher_id=?').get(req.params.id, tid(req));
  if (!record) return res.status(404).json({ error: 'Record not found or not yours' });
  const { date, category, description, action_taken } = req.body;
  db.prepare(`UPDATE student_behavior SET date=?,category=?,description=?,action_taken=?,updated_at=datetime('now') WHERE id=?`)
    .run(date ?? record.date, category ?? record.category, description ?? record.description, action_taken ?? record.action_taken, req.params.id);
  res.json(db.prepare('SELECT * FROM student_behavior WHERE id=?').get(req.params.id));
});

// DELETE /api/portal/teacher/behavior/:id
router.delete('/behavior/:id', ...guard, (req, res) => {
  const record = db.prepare('SELECT * FROM student_behavior WHERE id=? AND teacher_id=?').get(req.params.id, tid(req));
  if (!record) return res.status(404).json({ error: 'Record not found or not yours' });
  db.prepare('DELETE FROM student_behavior WHERE id=?').run(req.params.id);
  res.status(204).end();
});

// GET /api/portal/teacher/salary?month=
router.get('/salary', ...guard, (req, res) => {
  const { month } = req.query;
  let sql = 'SELECT * FROM teacher_payroll WHERE teacher_id=?';
  const params = [tid(req)];
  if (month) { sql += ' AND month=?'; params.push(month); }
  sql += ' ORDER BY month DESC';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/portal/teacher/withdrawals
router.get('/withdrawals', ...guard, (req, res) => {
  res.json(db.prepare('SELECT * FROM salary_withdrawals WHERE teacher_id=? ORDER BY created_at DESC').all(tid(req)));
});

// POST /api/portal/teacher/withdrawals
router.post('/withdrawals', ...guard, (req, res) => {
  const { payroll_id, amount, reason } = req.body;
  if (!amount || amount <= 0) return res.status(422).json({ error: 'amount required and must be positive' });
  const id = uuid();
  db.prepare(`INSERT INTO salary_withdrawals (id,teacher_id,payroll_id,amount,reason,created_at,updated_at)
    VALUES (?,?,?,?,?,datetime('now'),datetime('now'))`)
    .run(id, tid(req), payroll_id || null, amount, reason || null);
  res.status(201).json(db.prepare('SELECT * FROM salary_withdrawals WHERE id=?').get(id));
});

module.exports = router;
