const router = require('express').Router();
const db = require('../../db/database');
const authenticate = require('../../middleware/auth');
const authorize = require('../../middleware/authorize');

const guard = [authenticate, authorize('student')];
const sid = req => req.user.student_id;

// GET /api/portal/student/profile
router.get('/profile', ...guard, (req, res) => {
  const s = db.prepare('SELECT * FROM students WHERE id=?').get(sid(req));
  if (!s) return res.status(404).json({ error: 'Student profile not found' });
  res.json(s);
});

// GET /api/portal/student/marks?termId=
router.get('/marks', ...guard, (req, res) => {
  const { termId } = req.query;
  let sql = 'SELECT * FROM marks WHERE student_id=?';
  const params = [sid(req)];
  if (termId) { sql += ' AND term_id=?'; params.push(termId); }
  sql += ' ORDER BY subject_name';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/portal/student/attendance?from=&to=
router.get('/attendance', ...guard, (req, res) => {
  const { from, to } = req.query;
  let sql = 'SELECT * FROM attendance_records WHERE student_id=?';
  const params = [sid(req)];
  if (from) { sql += ' AND date>=?'; params.push(from); }
  if (to)   { sql += ' AND date<=?'; params.push(to); }
  sql += ' ORDER BY date DESC';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/portal/student/timetable
router.get('/timetable', ...guard, (req, res) => {
  const student = db.prepare('SELECT class_id FROM students WHERE id=?').get(sid(req));
  if (!student || !student.class_id) return res.json([]);
  const rows = db.prepare(`SELECT ts.*, t.first_name||' '||t.last_name AS teacher_name
    FROM teacher_schedule ts
    LEFT JOIN teachers t ON t.id=ts.teacher_id
    WHERE ts.class_id=?
    ORDER BY CASE ts.day WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2 WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 ELSE 5 END, ts.period_key`
  ).all(student.class_id);
  res.json(rows);
});

// GET /api/portal/student/report-cards
router.get('/report-cards', ...guard, (req, res) => {
  const cards = db.prepare(`SELECT rc.*, GROUP_CONCAT(rce.subject_name||':'||rce.total_score) AS subjects_summary
    FROM report_cards rc
    LEFT JOIN report_card_entries rce ON rce.report_card_id=rc.id
    WHERE rc.student_id=? AND rc.status IN ('published','printed')
    GROUP BY rc.id ORDER BY rc.created_at DESC`
  ).all(sid(req));
  res.json(cards);
});

// GET /api/portal/student/behavior
router.get('/behavior', ...guard, (req, res) => {
  const rows = db.prepare(`SELECT sb.*, t.first_name||' '||t.last_name AS teacher_name
    FROM student_behavior sb LEFT JOIN teachers t ON t.id=sb.teacher_id
    WHERE sb.student_id=? ORDER BY sb.date DESC`
  ).all(sid(req));
  res.json(rows);
});

module.exports = router;
