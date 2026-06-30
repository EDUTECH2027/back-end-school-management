const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');

const guard = [authenticate, authorize('super_admin', 'head_teacher')];

// GET /api/withdrawals?status=pending
router.get('/', ...guard, (req, res) => {
  const { status } = req.query;
  let sql = `SELECT sw.*, t.first_name||' '||t.last_name AS teacher_name, t.email AS teacher_email
             FROM salary_withdrawals sw
             LEFT JOIN teachers t ON t.id = sw.teacher_id
             WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND sw.status=?'; params.push(status); }
  sql += ' ORDER BY sw.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// PATCH /api/withdrawals/:id/status
router.patch('/:id/status', ...guard, (req, res) => {
  const { status, notes } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(422).json({ error: 'status must be approved or rejected' });
  }
  const record = db.prepare('SELECT * FROM salary_withdrawals WHERE id=?').get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Withdrawal not found' });
  db.prepare(`UPDATE salary_withdrawals SET status=?,reviewed_by=?,reviewed_at=datetime('now'),notes=?,updated_at=datetime('now') WHERE id=?`)
    .run(status, req.user.id, notes || null, req.params.id);
  res.json(db.prepare('SELECT * FROM salary_withdrawals WHERE id=?').get(req.params.id));
});

module.exports = router;
