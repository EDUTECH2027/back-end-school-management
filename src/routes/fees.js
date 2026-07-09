const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const flattenPayments = rec => rec ? { ...rec, payments: rec.payments } : null;
const PAYMENTS_INCLUDE = { payments: { orderBy: { payment_date: 'asc' } } };

const recalcStatus = (rec) => {
  if (rec.balance <= 0) return 'paid';
  if (rec.amount_paid > 0) return 'partial';
  const today = new Date().toISOString().slice(0, 10);
  if (rec.due_date && rec.due_date < today) return 'overdue';
  return 'pending';
};

// GET /api/fees?classId=c1&status=overdue&studentId=st1
router.get('/', authenticate, async (req, res) => {
  const { classId, status, studentId, academicYear } = req.query;
  const where = {};
  if (classId) where.class_id = classId;
  if (status) where.status = status;
  if (studentId) where.student_id = studentId;
  if (academicYear) where.academic_year = academicYear;
  const rows = await req.db.feeRecord.findMany({ where, include: PAYMENTS_INCLUDE, orderBy: { student_name: 'asc' } });
  res.json(rows.map(flattenPayments));
});

// GET /api/fees/summary  — aggregated stats
router.get('/summary', authenticate, async (req, res) => {
  const { academicYear } = req.query;
  const where = academicYear ? { academic_year: academicYear } : {};
  const [sums, paid, partial, overdue, total] = await Promise.all([
    req.db.feeRecord.aggregate({ where, _sum: { amount_due: true, amount_paid: true, balance: true } }),
    req.db.feeRecord.count({ where: { ...where, status: 'paid' } }),
    req.db.feeRecord.count({ where: { ...where, status: 'partial' } }),
    req.db.feeRecord.count({ where: { ...where, status: 'overdue' } }),
    req.db.feeRecord.count({ where }),
  ]);
  res.json({
    total_due: sums._sum.amount_due,
    total_collected: sums._sum.amount_paid,
    total_pending: sums._sum.balance,
    paid_count: paid,
    partial_count: partial,
    overdue_count: overdue,
    total_records: total,
  });
});

// GET /api/fees/:id
router.get('/:id', authenticate, async (req, res) => {
  const row = await req.db.feeRecord.findUnique({ where: { id: req.params.id }, include: PAYMENTS_INCLUDE });
  if (!row) return res.status(404).json({ error: 'Fee record not found' });
  res.json(flattenPayments(row));
});

// POST /api/fees
router.post('/', authenticate, async (req, res) => {
  const { studentId, feeName, academicYear, amountDue, dueDate } = req.body;
  if (!studentId || !feeName || !amountDue) return res.status(422).json({ error: 'studentId, feeName and amountDue required' });
  const student = await req.db.student.findUnique({ where: { id: studentId } });
  const id = uuid();
  const created = await req.db.feeRecord.create({
    data: {
      id, student_id: studentId, student_name: `${student?.first_name} ${student?.last_name}`, student_number: student?.student_number ?? null,
      class_id: student?.class_id ?? null, class_name: student?.class_name ?? null, fee_name: feeName, academic_year: academicYear || null,
      amount_due: amountDue, amount_paid: 0, balance: amountDue, status: 'pending', due_date: dueDate || null,
    },
    include: PAYMENTS_INCLUDE,
  });
  res.status(201).json(flattenPayments(created));
});

// POST /api/fees/:id/payments  — record a payment
router.post('/:id/payments', authenticate, async (req, res) => {
  const { amount, method, reference, paymentDate, receiptNumber } = req.body;
  if (!amount) return res.status(422).json({ error: 'amount required' });

  const fee = await req.db.feeRecord.findUnique({ where: { id: req.params.id } });
  if (!fee) return res.status(404).json({ error: 'Fee record not found' });

  const newPaid = fee.amount_paid + amount;
  const newBal = Math.max(0, fee.amount_due - newPaid);
  const newStatus = recalcStatus({ ...fee, amount_paid: newPaid, balance: newBal });

  const updated = await req.db.$transaction(async (tx) => {
    await tx.payment.create({
      data: { id: uuid(), fee_record_id: req.params.id, amount, method: method || null, reference: reference || null, payment_date: paymentDate || null, receipt_number: receiptNumber || null },
    });
    return tx.feeRecord.update({
      where: { id: req.params.id },
      data: { amount_paid: newPaid, balance: newBal, status: newStatus, updated_at: new Date() },
      include: PAYMENTS_INCLUDE,
    });
  });

  res.status(201).json(flattenPayments(updated));
});

// PUT /api/fees/:id
router.put('/:id', authenticate, async (req, res) => {
  const { feeName, amountDue, dueDate, status } = req.body;
  const fee = await req.db.feeRecord.findUnique({ where: { id: req.params.id } });
  if (!fee) return res.status(404).json({ error: 'Not found' });
  const newDue = amountDue ?? fee.amount_due;
  const newBal = Math.max(0, newDue - fee.amount_paid);
  const updated = await req.db.feeRecord.update({
    where: { id: req.params.id },
    data: {
      fee_name: feeName || fee.fee_name, amount_due: newDue, balance: newBal, due_date: dueDate || fee.due_date,
      status: status || recalcStatus({ ...fee, amount_due: newDue, balance: newBal }), updated_at: new Date(),
    },
    include: PAYMENTS_INCLUDE,
  });
  res.json(flattenPayments(updated));
});

module.exports = router;
