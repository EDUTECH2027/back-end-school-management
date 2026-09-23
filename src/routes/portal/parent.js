/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const authenticate = require('../../middleware/auth');
const authorize = require('../../middleware/authorize');
const { sortByDay } = require('../../utils/dayOrder');
const { getAnnualSummary } = require('../../utils/reportCardMath');

const guard = [authenticate, authorize('parent')];
const pid = req => req.user.parent_id;

async function assertChild(db, parentId, studentId, res) {
  const link = await db.parentStudent.findUnique({ where: { parent_id_student_id: { parent_id: parentId, student_id: studentId } } });
  if (!link) { res.status(403).json({ error: 'Not your child' }); return false; }
  return true;
}

// GET /api/portal/parent/profile
router.get('/profile', ...guard, async (req, res) => {
  const p = await req.db.parent.findUnique({ where: { id: pid(req) } });
  if (!p) return res.status(404).json({ error: 'Parent profile not found' });
  res.json(p);
});

// PUT /api/portal/parent/profile
router.put('/profile', ...guard, async (req, res) => {
  const { name, phone, address, occupation } = req.body;
  const p = await req.db.parent.findUnique({ where: { id: pid(req) } });
  if (!p) return res.status(404).json({ error: 'Parent profile not found' });
  await req.db.parent.update({
    where: { id: pid(req) },
    data: { name: name ?? p.name, phone: phone ?? p.phone, address: address ?? p.address, occupation: occupation ?? p.occupation, updated_at: new Date() },
  });
  res.json(await req.db.parent.findUnique({ where: { id: pid(req) } }));
});

// GET /api/portal/parent/children
router.get('/children', ...guard, async (req, res) => {
  const links = await req.db.parentStudent.findMany({ where: { parent_id: pid(req) }, include: { student: true } });
  res.json(links.map(l => l.student));
});

// GET /api/portal/parent/children/:sid/marks?termId=
router.get('/children/:sid/marks', ...guard, async (req, res) => {
  if (!(await assertChild(req.db, pid(req), req.params.sid, res))) return;
  const { termId } = req.query;
  const where = { student_id: req.params.sid };
  if (termId) where.term_id = termId;
  res.json(await req.db.mark.findMany({ where, orderBy: { subject_name: 'asc' } }));
});

// GET /api/portal/parent/children/:sid/attendance?from=&to=
router.get('/children/:sid/attendance', ...guard, async (req, res) => {
  if (!(await assertChild(req.db, pid(req), req.params.sid, res))) return;
  const { from, to } = req.query;
  const where = { student_id: req.params.sid };
  if (from || to) where.date = { ...(from && { gte: from }), ...(to && { lte: to }) };
  res.json(await req.db.attendanceRecord.findMany({ where, orderBy: { date: 'desc' } }));
});

// GET /api/portal/parent/children/:sid/fees
router.get('/children/:sid/fees', ...guard, async (req, res) => {
  if (!(await assertChild(req.db, pid(req), req.params.sid, res))) return;
  const fees = await req.db.feeRecord.findMany({
    where: { student_id: req.params.sid },
    include: { payments: { select: { amount: true, method: true, payment_date: true } } },
    orderBy: { created_at: 'desc' },
  });
  res.json(fees.map(({ payments, ...rest }) => ({
    ...rest,
    payments: payments.map(p => ({ amount: p.amount, method: p.method, date: p.payment_date })),
  })));
});

// GET /api/portal/parent/children/:sid/timetable
router.get('/children/:sid/timetable', ...guard, async (req, res) => {
  if (!(await assertChild(req.db, pid(req), req.params.sid, res))) return;
  const student = await req.db.student.findUnique({ where: { id: req.params.sid }, select: { class_id: true } });
  if (!student || !student.class_id) return res.json([]);
  const rows = await req.db.teacherSchedule.findMany({
    where: { class_id: student.class_id },
    include: { teacher: { select: { first_name: true, last_name: true } } },
  });
  res.json(sortByDay(rows, 'day', 'period_key').map(({ teacher, ...rest }) => ({
    ...rest, teacher_name: teacher ? `${teacher.first_name} ${teacher.last_name}` : null,
  })));
});

// GET /api/portal/parent/children/:sid/annual-average?academicYearId= (defaults to the current academic year)
router.get('/children/:sid/annual-average', ...guard, async (req, res) => {
  if (!(await assertChild(req.db, pid(req), req.params.sid, res))) return;
  let { academicYearId } = req.query;
  if (!academicYearId) {
    const currentAy = await req.db.academicYear.findFirst({ where: { is_current: true } });
    academicYearId = currentAy?.id;
  }
  if (!academicYearId) return res.json({ terms: { first: null, second: null, third: null }, termsFound: 0, finalAverage: null });
  res.json(await getAnnualSummary(req.db, { studentId: req.params.sid, academicYearId }));
});

// GET /api/portal/parent/children/:sid/report-cards
router.get('/children/:sid/report-cards', ...guard, async (req, res) => {
  if (!(await assertChild(req.db, pid(req), req.params.sid, res))) return;
  const cards = await req.db.reportCard.findMany({
    where: { student_id: req.params.sid, status: { in: ['published', 'printed'] } },
    orderBy: { created_at: 'desc' },
  });
  res.json(cards);
});

// GET /api/portal/parent/children/:sid/behavior
router.get('/children/:sid/behavior', ...guard, async (req, res) => {
  if (!(await assertChild(req.db, pid(req), req.params.sid, res))) return;
  const rows = await req.db.studentBehavior.findMany({
    where: { student_id: req.params.sid },
    include: { teacher: { select: { first_name: true, last_name: true } } },
    orderBy: { date: 'desc' },
  });
  res.json(rows.map(({ teacher, ...rest }) => ({ ...rest, teacher_name: teacher ? `${teacher.first_name} ${teacher.last_name}` : null })));
});

module.exports = router;
