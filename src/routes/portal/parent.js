const router = require('express').Router();
const db = require('../../db/database');
const authenticate = require('../../middleware/auth');
const authorize = require('../../middleware/authorize');

const guard = [authenticate, authorize('parent')];
const pid = req => req.user.parent_id;

function assertChild(parentId, studentId, res) {
  const link = db.prepare('SELECT 1 FROM parent_students WHERE parent_id=? AND student_id=?').get(parentId, studentId);
  if (!link) { res.status(403).json({ error: 'Not your child' }); return false; }
  return true;
}

// GET /api/portal/parent/profile
router.get('/profile', ...guard, (req, res) => {
  const p = db.prepare('SELECT * FROM parents WHERE id=?').get(pid(req));
  if (!p) return res.status(404).json({ error: 'Parent profile not found' });
  res.json(p);
});

// PUT /api/portal/parent/profile
router.put('/profile', ...guard, (req, res) => {
  const { name, phone, address, occupation } = req.body;
  const p = db.prepare('SELECT * FROM parents WHERE id=?').get(pid(req));
  if (!p) return res.status(404).json({ error: 'Parent profile not found' });
  db.prepare("UPDATE parents SET name=?,phone=?,address=?,occupation=?,updated_at=datetime('now') WHERE id=?")
    .run(name ?? p.name, phone ?? p.phone, address ?? p.address, occupation ?? p.occupation, pid(req));
  res.json(db.prepare('SELECT * FROM parents WHERE id=?').get(pid(req)));
});

// GET /api/portal/parent/children
router.get('/children', ...guard, (req, res) => {
  const children = db.prepare(`SELECT s.* FROM students s
    JOIN parent_students ps ON ps.student_id=s.id WHERE ps.parent_id=?`).all(pid(req));
  res.json(children);
});

// GET /api/portal/parent/children/:sid/marks?termId=
router.get('/children/:sid/marks', ...guard, (req, res) => {
  if (!assertChild(pid(req), req.params.sid, res)) return;
  const { termId } = req.query;
  let sql = 'SELECT * FROM marks WHERE student_id=?';
  const params = [req.params.sid];
  if (termId) { sql += ' AND term_id=?'; params.push(termId); }
  sql += ' ORDER BY subject_name';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/portal/parent/children/:sid/attendance?from=&to=
router.get('/children/:sid/attendance', ...guard, (req, res) => {
  if (!assertChild(pid(req), req.params.sid, res)) return;
  const { from, to } = req.query;
  let sql = 'SELECT * FROM attendance_records WHERE student_id=?';
  const params = [req.params.sid];
  if (from) { sql += ' AND date>=?'; params.push(from); }
  if (to)   { sql += ' AND date<=?'; params.push(to); }
  sql += ' ORDER BY date DESC';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/portal/parent/children/:sid/fees
router.get('/children/:sid/fees', ...guard, (req, res) => {
  if (!assertChild(pid(req), req.params.sid, res)) return;
  const fees = db.prepare(`SELECT fr.*, JSON_GROUP_ARRAY(JSON_OBJECT('amount',p.amount,'method',p.method,'date',p.payment_date)) AS payments
    FROM fee_records fr LEFT JOIN payments p ON p.fee_record_id=fr.id
    WHERE fr.student_id=? GROUP BY fr.id ORDER BY fr.created_at DESC`
  ).all(req.params.sid);
  res.json(fees);
});

// GET /api/portal/parent/children/:sid/report-cards
router.get('/children/:sid/report-cards', ...guard, (req, res) => {
  if (!assertChild(pid(req), req.params.sid, res)) return;
  const cards = db.prepare(`SELECT * FROM report_cards WHERE student_id=? AND status IN ('published','printed') ORDER BY created_at DESC`).all(req.params.sid);
  res.json(cards);
});

// GET /api/portal/parent/children/:sid/behavior
router.get('/children/:sid/behavior', ...guard, (req, res) => {
  if (!assertChild(pid(req), req.params.sid, res)) return;
  const rows = db.prepare(`SELECT sb.*, t.first_name||' '||t.last_name AS teacher_name
    FROM student_behavior sb LEFT JOIN teachers t ON t.id=sb.teacher_id
    WHERE sb.student_id=? ORDER BY sb.date DESC`
  ).all(req.params.sid);
  res.json(rows);
});

module.exports = router;
