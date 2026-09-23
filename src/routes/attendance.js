/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

// ── Student Attendance ──────────────────────────────────────────────

// GET /api/attendance?date=YYYY-MM-DD&classId=c1
// NOTE: route order matters — /stats and /teachers must be declared before /:id-shaped
// routes in files that have them, same as the original; this file has no /:id GET so
// no collision risk, but PUT /:id below still needs to come after these specific paths.
router.get('/', authenticate, async (req, res) => {
  const { date, classId, studentId, from, to } = req.query;
  const where = {};
  if (classId) where.class_id = classId;
  if (studentId) where.student_id = studentId;
  if (date) {
    where.date = date;
  } else if (from || to) {
    where.date = { ...(from && { gte: from }), ...(to && { lte: to }) };
  }
  const rows = await req.db.attendanceRecord.findMany({ where, orderBy: [{ date: 'desc' }, { student_name: 'asc' }] });
  res.json(rows);
});

// POST /api/attendance  — bulk upsert for a class on a given date
router.post('/', authenticate, async (req, res) => {
  const records = req.body; // [{ studentId, studentName, studentNumber, classId, className, date, status, remarks }]
  if (!Array.isArray(records)) return res.status(422).json({ error: 'Body must be an array' });

  await req.db.$transaction(records.map(r => req.db.attendanceRecord.upsert({
    where: { attendance_student_date: { student_id: r.studentId, date: r.date } },
    create: {
      id: r.id || uuid(), student_id: r.studentId, student_name: r.studentName || null, student_number: r.studentNumber || null,
      class_id: r.classId, class_name: r.className || null, date: r.date, status: r.status, remarks: r.remarks || null,
    },
    update: { status: r.status, remarks: r.remarks || null },
  })));
  res.status(201).json({ saved: records.length });
});

// GET /api/attendance/stats?classId=c1&month=2025-06
router.get('/stats', authenticate, async (req, res) => {
  const { classId, month } = req.query;
  if (!classId || !month) return res.status(422).json({ error: 'classId and month required' });
  const [y, m] = month.split('-');
  const from = `${y}-${m}-01`;
  const to = `${y}-${m}-31`;

  const rows = await req.db.attendanceRecord.findMany({
    where: { class_id: classId, date: { gte: from, lte: to } },
    select: { student_id: true, student_name: true, status: true },
  });
  const byStudent = new Map();
  for (const r of rows) {
    if (!byStudent.has(r.student_id)) {
      byStudent.set(r.student_id, { student_id: r.student_id, student_name: r.student_name, present: 0, absent: 0, late: 0, excused: 0, total: 0 });
    }
    const s = byStudent.get(r.student_id);
    s[r.status]++;
    s.total++;
  }
  res.json([...byStudent.values()]);
});

// PUT /api/attendance/:id
router.put('/:id', authenticate, async (req, res) => {
  const { status, remarks } = req.body;
  const updated = await req.db.attendanceRecord.update({ where: { id: req.params.id }, data: { status, remarks: remarks || null } });
  res.json(updated);
});

// ── Teacher Attendance ──────────────────────────────────────────────

// GET /api/attendance/teachers?teacherId=tc1&month=2025-06&status=late&source=qr_scan
router.get('/teachers', authenticate, async (req, res) => {
  const { teacherId, month, date, status, source } = req.query;
  const where = {};
  if (teacherId) where.teacher_id = teacherId;
  if (date) where.date = date;
  if (month) where.date = { startsWith: month };
  if (status) where.status = status;
  if (source) where.source = source;
  const rows = await req.db.teacherAttendance.findMany({
    where, include: { teacher: { select: { first_name: true, last_name: true } } }, orderBy: { date: 'desc' },
  });
  res.json(rows.map(({ teacher, ...rest }) => ({ ...rest, first_name: teacher?.first_name ?? null, last_name: teacher?.last_name ?? null })));
});

// GET /api/attendance/teachers/summary?month=2025-06 — totals for the reporting view.
router.get('/teachers/summary', authenticate, async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(422).json({ error: 'month required' });

  const rows = await req.db.teacherAttendance.findMany({
    where: { date: { startsWith: month } },
    include: { teacher: { select: { first_name: true, last_name: true } } },
  });

  const byTeacher = new Map();
  const totals = { on_time: 0, late: 0, absent: 0, excused: 0, total: 0 };
  for (const r of rows) {
    if (!byTeacher.has(r.teacher_id)) {
      byTeacher.set(r.teacher_id, {
        teacher_id: r.teacher_id,
        teacher_name: r.teacher ? `${r.teacher.first_name} ${r.teacher.last_name}` : null,
        on_time: 0, late: 0, absent: 0, excused: 0, total: 0,
      });
    }
    const s = byTeacher.get(r.teacher_id);
    const key = r.status === 'present' ? 'on_time' : r.status;
    if (key in s) { s[key]++; totals[key]++; }
    s.total++; totals.total++;
  }

  res.json({ month, totals, byTeacher: [...byTeacher.values()] });
});

// POST /api/attendance/teachers
router.post('/teachers', authenticate, async (req, res) => {
  const records = req.body;
  if (!Array.isArray(records)) return res.status(422).json({ error: 'Body must be an array' });

  await req.db.$transaction(records.map(r => req.db.teacherAttendance.upsert({
    where: { teacher_attendance_teacher_date: { teacher_id: r.teacherId, date: r.date } },
    create: { id: r.id || uuid(), teacher_id: r.teacherId, date: r.date, status: r.status, remarks: r.remarks || null },
    update: { status: r.status, remarks: r.remarks || null },
  })));
  res.status(201).json({ saved: records.length });
});

module.exports = router;
