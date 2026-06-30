const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const withPayments = (rec) => {
  if (!rec) return null;
  const payments = db.prepare('SELECT * FROM payments WHERE fee_record_id=? ORDER BY payment_date').all(rec.id);
  return { ...rec, payments };
};

const recalcStatus = (rec) => {
  if (rec.balance <= 0) return 'paid';
  if (rec.amount_paid > 0) return 'partial';
  const today = new Date().toISOString().slice(0,10);
  if (rec.due_date && rec.due_date < today) return 'overdue';
  return 'pending';
};

// GET /api/fees?classId=c1&status=overdue&studentId=st1
router.get('/', authenticate, (req, res) => {
  const { classId, status, studentId, academicYear } = req.query;
  let sql = 'SELECT * FROM fee_records WHERE 1=1';
  const params = [];
  if (classId)      { sql += ' AND class_id=?';      params.push(classId); }
  if (status)       { sql += ' AND status=?';         params.push(status); }
  if (studentId)    { sql += ' AND student_id=?';     params.push(studentId); }
  if (academicYear) { sql += ' AND academic_year=?';  params.push(academicYear); }
  sql += ' ORDER BY student_name';
  res.json(db.prepare(sql).all(...params).map(withPayments));
});

// GET /api/fees/summary  — aggregated stats
router.get('/summary', authenticate, (req, res) => {
  const { academicYear } = req.query;
  const filter = academicYear ? 'WHERE academic_year=?' : '';
  const params = academicYear ? [academicYear] : [];
  const row = db.prepare(`
    SELECT
      SUM(amount_due)                                        AS total_due,
      SUM(amount_paid)                                       AS total_collected,
      SUM(balance)                                           AS total_pending,
      SUM(CASE WHEN status='paid'    THEN 1 ELSE 0 END)     AS paid_count,
      SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END)     AS partial_count,
      SUM(CASE WHEN status='overdue' THEN 1 ELSE 0 END)     AS overdue_count,
      COUNT(*)                                               AS total_records
    FROM fee_records ${filter}
  `).get(...params);
  res.json(row);
});

// GET /api/fees/:id
router.get('/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT * FROM fee_records WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Fee record not found' });
  res.json(withPayments(row));
});

// POST /api/fees
router.post('/', authenticate, (req, res) => {
  const { studentId, feeName, academicYear, amountDue, dueDate } = req.body;
  if (!studentId || !feeName || !amountDue) return res.status(422).json({ error: 'studentId, feeName and amountDue required' });
  const student = db.prepare('SELECT * FROM students WHERE id=?').get(studentId);
  const id = uuid();
  db.prepare(`INSERT INTO fee_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
    .run(id, studentId, student?.first_name + ' ' + student?.last_name, student?.student_number,
         student?.class_id||null, student?.class_name||null, feeName, academicYear||null,
         amountDue, 0, amountDue, 'pending', dueDate||null);
  res.status(201).json(withPayments(db.prepare('SELECT * FROM fee_records WHERE id=?').get(id)));
});

// POST /api/fees/:id/payments  — record a payment
router.post('/:id/payments', authenticate, (req, res) => {
  const { amount, method, reference, paymentDate, receiptNumber } = req.body;
  if (!amount) return res.status(422).json({ error: 'amount required' });

  const fee = db.prepare('SELECT * FROM fee_records WHERE id=?').get(req.params.id);
  if (!fee) return res.status(404).json({ error: 'Fee record not found' });

  const payId = uuid();
  db.prepare(`INSERT INTO payments VALUES (?,?,?,?,?,?,?,datetime('now'))`)
    .run(payId, req.params.id, amount, method||null, reference||null, paymentDate||null, receiptNumber||null);

  const newPaid = fee.amount_paid + amount;
  const newBal  = Math.max(0, fee.amount_due - newPaid);
  const updatedFee = { ...fee, amount_paid: newPaid, balance: newBal };
  const newStatus = recalcStatus(updatedFee);

  db.prepare(`UPDATE fee_records SET amount_paid=?,balance=?,status=?,updated_at=datetime('now') WHERE id=?`)
    .run(newPaid, newBal, newStatus, req.params.id);

  res.status(201).json(withPayments(db.prepare('SELECT * FROM fee_records WHERE id=?').get(req.params.id)));
});

// PUT /api/fees/:id
router.put('/:id', authenticate, (req, res) => {
  const { feeName, amountDue, dueDate, status } = req.body;
  const fee = db.prepare('SELECT * FROM fee_records WHERE id=?').get(req.params.id);
  if (!fee) return res.status(404).json({ error: 'Not found' });
  const newDue = amountDue ?? fee.amount_due;
  const newBal = Math.max(0, newDue - fee.amount_paid);
  db.prepare(`UPDATE fee_records SET fee_name=?,amount_due=?,balance=?,due_date=?,status=?,updated_at=datetime('now') WHERE id=?`)
    .run(feeName||fee.fee_name, newDue, newBal, dueDate||fee.due_date, status||recalcStatus({...fee, amount_due:newDue, balance:newBal}), req.params.id);
  res.json(withPayments(db.prepare('SELECT * FROM fee_records WHERE id=?').get(req.params.id)));
});

module.exports = router;
