const router = require('express').Router();
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');

const guard = [authenticate, authorize('super_admin', 'head_teacher')];

// GET /api/withdrawals?status=pending
router.get('/', ...guard, async (req, res) => {
  const { status } = req.query;
  const where = status ? { status } : {};
  const rows = await req.db.salaryWithdrawal.findMany({
    where,
    include: { teacher: { select: { first_name: true, last_name: true, email: true } } },
    orderBy: { created_at: 'desc' },
  });
  res.json(rows.map(({ teacher, ...rest }) => ({
    ...rest,
    teacher_name: teacher ? `${teacher.first_name} ${teacher.last_name}` : null,
    teacher_email: teacher?.email ?? null,
  })));
});

// PATCH /api/withdrawals/:id/status
router.patch('/:id/status', ...guard, async (req, res) => {
  const { status, notes } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(422).json({ error: 'status must be approved or rejected' });
  }
  const record = await req.db.salaryWithdrawal.findUnique({ where: { id: req.params.id } });
  if (!record) return res.status(404).json({ error: 'Withdrawal not found' });
  // reviewed_at is a plain String column (matches original TEXT/datetime('now') convention)
  const reviewedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const updated = await req.db.salaryWithdrawal.update({
    where: { id: req.params.id },
    data: { status, reviewed_by: req.user.id, reviewed_at: reviewedAt, notes: notes || null, updated_at: new Date() },
  });
  res.json(updated);
});

module.exports = router;
