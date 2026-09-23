/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');
const { calcNet } = require('../utils/payroll');
const { getMonthlyAttendance } = require('../utils/attendanceSummary');

const withTeacher = async (db, r) => {
  if (!r) return null;
  const { teacher, ...rest } = r;
  let subjects = [];
  if (teacher) { try { subjects = JSON.parse(teacher.subjects || '[]'); } catch { subjects = []; } }
  return {
    ...rest,
    teacher: teacher ? { first_name: teacher.first_name, last_name: teacher.last_name, subjects } : null,
    net_pay: calcNet(r),
    // Live, not stored — the centralized attendance system stays the one source of truth.
    attendance_detail: await getMonthlyAttendance(db, r.teacher_id, r.month),
  };
};
const TEACHER_INCLUDE = { teacher: { select: { first_name: true, last_name: true, subjects: true } } };

// GET /api/payroll?month=2024-01&teacherId=x&status=paid
router.get('/', authenticate, async (req, res) => {
  const { month, teacherId, status } = req.query;
  const where = {};
  if (month) where.month = month;
  if (teacherId) where.teacher_id = teacherId;
  if (status) where.status = status;
  const rows = await req.db.teacherPayroll.findMany({ where, include: TEACHER_INCLUDE, orderBy: [{ month: 'desc' }, { teacher_id: 'asc' }] });
  res.json(await Promise.all(rows.map(r => withTeacher(req.db, r))));
});

// GET /api/payroll/summary?month=2024-01
router.get('/summary', authenticate, async (req, res) => {
  const { month } = req.query;
  const where = month ? { month } : {};
  const rows = await req.db.teacherPayroll.findMany({ where });

  const byMonth = new Map();
  for (const r of rows) {
    if (!byMonth.has(r.month)) {
      byMonth.set(r.month, { month: r.month, total_records: 0, total_net_pay: 0, total_bonuses: 0, total_deductions: 0, paid_count: 0, pending_count: 0, draft_count: 0 });
    }
    const s = byMonth.get(r.month);
    s.total_records++;
    s.total_net_pay += calcNet(r);
    s.total_bonuses += r.bonus;
    s.total_deductions += r.absence_deduction * r.absences + r.late_deduction * r.late_coming;
    if (r.status === 'paid') s.paid_count++;
    else if (r.status === 'pending') s.pending_count++;
    else if (r.status === 'draft') s.draft_count++;
  }
  res.json([...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)));
});

// GET /api/payroll/:id
router.get('/:id', authenticate, async (req, res) => {
  const row = await req.db.teacherPayroll.findUnique({ where: { id: req.params.id }, include: TEACHER_INCLUDE });
  if (!row) return res.status(404).json({ error: 'Payroll record not found' });
  res.json(await withTeacher(req.db, row));
});

// POST /api/payroll  — create payroll entry for a teacher/month
router.post('/', authenticate, async (req, res) => {
  const {
    teacherId, month,
    hourlyRate, contractedHours, baseAllowance,
    absenceDeduction, lateDeduction,
    hoursWorked, absences, lateComing, bonus, notes, status,
  } = req.body;

  if (!teacherId || !month) return res.status(422).json({ error: 'teacherId and month required' });

  const teacher = await req.db.teacher.findUnique({ where: { id: teacherId } });
  if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

  const existing = await req.db.teacherPayroll.findFirst({ where: { teacher_id: teacherId, month } });
  if (existing) return res.status(409).json({ error: 'Payroll record already exists for this teacher and month' });

  const id = uuid();
  const created = await req.db.teacherPayroll.create({
    data: {
      id, teacher_id: teacherId, month,
      hourly_rate: hourlyRate ?? 3500, contracted_hours: contractedHours ?? 80, base_allowance: baseAllowance ?? 50000,
      absence_deduction: absenceDeduction ?? 12000, late_deduction: lateDeduction ?? 2500,
      hours_worked: hoursWorked ?? 0, absences: absences ?? 0, late_coming: lateComing ?? 0,
      bonus: bonus ?? 0, notes: notes ?? '', status: status ?? 'draft',
    },
    include: TEACHER_INCLUDE,
  });

  res.status(201).json(await withTeacher(req.db, created));
});

// POST /api/payroll/bulk  — generate draft payroll for all active teachers for a month
router.post('/bulk', authenticate, async (req, res) => {
  const { month, baseAllowance, hourlyRate, contractedHours, absenceDeduction, lateDeduction } = req.body;
  if (!month) return res.status(422).json({ error: 'month required' });

  const teachers = await req.db.teacher.findMany({ where: { is_active: true }, select: { id: true } });
  const existingIds = new Set(
    (await req.db.teacherPayroll.findMany({ where: { month, teacher_id: { in: teachers.map(t => t.id) } }, select: { teacher_id: true } }))
      .map(r => r.teacher_id)
  );

  const toCreate = teachers.filter(t => !existingIds.has(t.id));
  if (toCreate.length > 0) {
    // Prefill absences/late_coming from the centralized attendance system —
    // one-time seed only: existing rows (skipped above) are never touched again,
    // so a later manual correction here is never silently overwritten.
    const attendanceByTeacher = await Promise.all(
      toCreate.map(t => getMonthlyAttendance(req.db, t.id, month))
    );
    await req.db.$transaction(toCreate.map((t, i) => req.db.teacherPayroll.create({
      data: {
        id: uuid(), teacher_id: t.id, month,
        hourly_rate: hourlyRate ?? 3500, contracted_hours: contractedHours ?? 80, base_allowance: baseAllowance ?? 50000,
        absence_deduction: absenceDeduction ?? 12000, late_deduction: lateDeduction ?? 2500,
        hours_worked: 0, absences: attendanceByTeacher[i].absences, late_coming: attendanceByTeacher[i].daysLate,
        bonus: 0, notes: '', status: 'draft',
      },
    })));
  }

  res.status(201).json({ created: toCreate.length, skipped: existingIds.size });
});

// PUT /api/payroll/:id
router.put('/:id', authenticate, async (req, res) => {
  const row = await req.db.teacherPayroll.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'Payroll record not found' });

  const {
    hourlyRate, contractedHours, baseAllowance,
    absenceDeduction, lateDeduction,
    hoursWorked, absences, lateComing, bonus, notes, status,
  } = req.body;

  const updated = await req.db.teacherPayroll.update({
    where: { id: req.params.id },
    data: {
      hourly_rate: hourlyRate ?? row.hourly_rate, contracted_hours: contractedHours ?? row.contracted_hours, base_allowance: baseAllowance ?? row.base_allowance,
      absence_deduction: absenceDeduction ?? row.absence_deduction, late_deduction: lateDeduction ?? row.late_deduction,
      hours_worked: hoursWorked ?? row.hours_worked, absences: absences ?? row.absences, late_coming: lateComing ?? row.late_coming,
      bonus: bonus ?? row.bonus, notes: notes ?? row.notes, status: status ?? row.status, updated_at: new Date(),
    },
    include: TEACHER_INCLUDE,
  });

  res.json(await withTeacher(req.db, updated));
});

// PATCH /api/payroll/:id/status
router.patch('/:id/status', authenticate, async (req, res) => {
  const { status } = req.body;
  if (!['draft', 'pending', 'paid'].includes(status)) {
    return res.status(422).json({ error: 'status must be draft, pending, or paid' });
  }
  const row = await req.db.teacherPayroll.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'Payroll record not found' });
  const updated = await req.db.teacherPayroll.update({ where: { id: req.params.id }, data: { status, updated_at: new Date() }, include: TEACHER_INCLUDE });
  res.json(await withTeacher(req.db, updated));
});

// DELETE /api/payroll/:id
router.delete('/:id', authenticate, async (req, res) => {
  const row = await req.db.teacherPayroll.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'Payroll record not found' });
  await req.db.teacherPayroll.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
