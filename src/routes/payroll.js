const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const calcNet = (r) =>
  (r.base_allowance + r.hourly_rate * r.hours_worked)
  - (r.absence_deduction * r.absences)
  - (r.late_deduction * r.late_coming)
  + r.bonus;

const withTeacher = (r) => {
  if (!r) return null;
  const raw = db.prepare('SELECT first_name, last_name, subjects FROM teachers WHERE id=?').get(r.teacher_id);
  let teacher = null;
  if (raw) {
    let subjects = [];
    try { subjects = JSON.parse(raw.subjects || '[]'); } catch { subjects = []; }
    teacher = { first_name: raw.first_name, last_name: raw.last_name, subjects };
  }
  return { ...r, teacher, net_pay: calcNet(r) };
};

// GET /api/payroll?month=2024-01&teacherId=x&status=paid
router.get('/', authenticate, (req, res) => {
  const { month, teacherId, status } = req.query;
  let sql = 'SELECT * FROM teacher_payroll WHERE 1=1';
  const params = [];
  if (month)     { sql += ' AND month=?';      params.push(month); }
  if (teacherId) { sql += ' AND teacher_id=?'; params.push(teacherId); }
  if (status)    { sql += ' AND status=?';     params.push(status); }
  sql += ' ORDER BY month DESC, teacher_id';
  res.json(db.prepare(sql).all(...params).map(withTeacher));
});

// GET /api/payroll/summary?month=2024-01
router.get('/summary', authenticate, (req, res) => {
  const { month } = req.query;
  const filter = month ? 'WHERE month=?' : '';
  const params = month ? [month] : [];
  const rows = db.prepare(`
    SELECT
      month,
      COUNT(*)                                                AS total_records,
      SUM(base_allowance + hourly_rate * hours_worked
          - absence_deduction * absences
          - late_deduction * late_coming
          + bonus)                                           AS total_net_pay,
      SUM(bonus)                                             AS total_bonuses,
      SUM(absence_deduction * absences
          + late_deduction * late_coming)                   AS total_deductions,
      SUM(CASE WHEN status='paid'    THEN 1 ELSE 0 END)     AS paid_count,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END)     AS pending_count,
      SUM(CASE WHEN status='draft'   THEN 1 ELSE 0 END)     AS draft_count
    FROM teacher_payroll ${filter}
    GROUP BY month
    ORDER BY month DESC
  `).all(...params);
  res.json(rows);
});

// GET /api/payroll/:id
router.get('/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT * FROM teacher_payroll WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Payroll record not found' });
  res.json(withTeacher(row));
});

// POST /api/payroll  — create payroll entry for a teacher/month
router.post('/', authenticate, (req, res) => {
  const {
    teacherId, month,
    hourlyRate, contractedHours, baseAllowance,
    absenceDeduction, lateDeduction,
    hoursWorked, absences, lateComing, bonus, notes, status,
  } = req.body;

  if (!teacherId || !month) return res.status(422).json({ error: 'teacherId and month required' });

  const teacher = db.prepare('SELECT id FROM teachers WHERE id=?').get(teacherId);
  if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

  const existing = db.prepare('SELECT id FROM teacher_payroll WHERE teacher_id=? AND month=?').get(teacherId, month);
  if (existing) return res.status(409).json({ error: 'Payroll record already exists for this teacher and month' });

  const id = uuid();
  db.prepare(`
    INSERT INTO teacher_payroll
      (id, teacher_id, month, hourly_rate, contracted_hours, base_allowance,
       absence_deduction, late_deduction, hours_worked, absences, late_coming,
       bonus, notes, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
  `).run(
    id, teacherId, month,
    hourlyRate       ?? 3500,
    contractedHours  ?? 80,
    baseAllowance    ?? 50000,
    absenceDeduction ?? 12000,
    lateDeduction    ?? 2500,
    hoursWorked      ?? 0,
    absences         ?? 0,
    lateComing       ?? 0,
    bonus            ?? 0,
    notes            ?? '',
    status           ?? 'draft',
  );

  res.status(201).json(withTeacher(db.prepare('SELECT * FROM teacher_payroll WHERE id=?').get(id)));
});

// POST /api/payroll/bulk  — generate draft payroll for all active teachers for a month
router.post('/bulk', authenticate, (req, res) => {
  const { month, baseAllowance, hourlyRate, contractedHours, absenceDeduction, lateDeduction } = req.body;
  if (!month) return res.status(422).json({ error: 'month required' });

  const teachers = db.prepare('SELECT id FROM teachers WHERE is_active=1').all();
  let created = 0;
  let skipped = 0;

  for (const t of teachers) {
    const existing = db.prepare('SELECT id FROM teacher_payroll WHERE teacher_id=? AND month=?').get(t.id, month);
    if (existing) { skipped++; continue; }

    db.prepare(`
      INSERT INTO teacher_payroll
        (id, teacher_id, month, hourly_rate, contracted_hours, base_allowance,
         absence_deduction, late_deduction, hours_worked, absences, late_coming,
         bonus, notes, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
    `).run(
      uuid(), t.id, month,
      hourlyRate       ?? 3500,
      contractedHours  ?? 80,
      baseAllowance    ?? 50000,
      absenceDeduction ?? 12000,
      lateDeduction    ?? 2500,
      0, 0, 0, 0, '', 'draft',
    );
    created++;
  }

  res.status(201).json({ created, skipped });
});

// PUT /api/payroll/:id
router.put('/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT * FROM teacher_payroll WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Payroll record not found' });

  const {
    hourlyRate, contractedHours, baseAllowance,
    absenceDeduction, lateDeduction,
    hoursWorked, absences, lateComing, bonus, notes, status,
  } = req.body;

  db.prepare(`
    UPDATE teacher_payroll SET
      hourly_rate=?, contracted_hours=?, base_allowance=?,
      absence_deduction=?, late_deduction=?,
      hours_worked=?, absences=?, late_coming=?,
      bonus=?, notes=?, status=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    hourlyRate       ?? row.hourly_rate,
    contractedHours  ?? row.contracted_hours,
    baseAllowance    ?? row.base_allowance,
    absenceDeduction ?? row.absence_deduction,
    lateDeduction    ?? row.late_deduction,
    hoursWorked      ?? row.hours_worked,
    absences         ?? row.absences,
    lateComing       ?? row.late_coming,
    bonus            ?? row.bonus,
    notes            ?? row.notes,
    status           ?? row.status,
    req.params.id,
  );

  res.json(withTeacher(db.prepare('SELECT * FROM teacher_payroll WHERE id=?').get(req.params.id)));
});

// PATCH /api/payroll/:id/status
router.patch('/:id/status', authenticate, (req, res) => {
  const { status } = req.body;
  if (!['draft', 'pending', 'paid'].includes(status)) {
    return res.status(422).json({ error: 'status must be draft, pending, or paid' });
  }
  const row = db.prepare('SELECT * FROM teacher_payroll WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Payroll record not found' });
  db.prepare(`UPDATE teacher_payroll SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
  res.json(withTeacher(db.prepare('SELECT * FROM teacher_payroll WHERE id=?').get(req.params.id)));
});

// DELETE /api/payroll/:id
router.delete('/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT id FROM teacher_payroll WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Payroll record not found' });
  db.prepare('DELETE FROM teacher_payroll WHERE id=?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
