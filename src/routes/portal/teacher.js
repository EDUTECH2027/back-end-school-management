const router = require('express').Router();
const { v4: uuid } = require('uuid');
const authenticate = require('../../middleware/auth');
const authorize = require('../../middleware/authorize');
const { sortByDay } = require('../../utils/dayOrder');

const guard = [authenticate, authorize('teacher', 'head_teacher', 'super_admin')];
const tid = req => req.user.teacher_id;

async function ownsClass(db, classId, teacherId) {
  return !!(await db.class.findFirst({ where: { id: classId, class_teacher_id: teacherId } }));
}

// GET /api/portal/teacher/profile
router.get('/profile', ...guard, async (req, res) => {
  const t = await req.db.teacher.findUnique({ where: { id: tid(req) } });
  if (!t) return res.status(404).json({ error: 'Teacher profile not found' });
  res.json(t);
});

// PUT /api/portal/teacher/profile  (limited fields only)
router.put('/profile', ...guard, async (req, res) => {
  const { phone, qualification } = req.body;
  await req.db.teacher.update({ where: { id: tid(req) }, data: { phone: phone ?? null, qualification: qualification ?? null, updated_at: new Date() } });
  res.json(await req.db.teacher.findUnique({ where: { id: tid(req) } }));
});

// GET /api/portal/teacher/classes
router.get('/classes', ...guard, async (req, res) => {
  res.json(await req.db.class.findMany({ where: { class_teacher_id: tid(req) } }));
});

// GET /api/portal/teacher/timetable
router.get('/timetable', ...guard, async (req, res) => {
  const rows = await req.db.teacherSchedule.findMany({
    where: { teacher_id: tid(req) },
    include: { class: { select: { name: true } } },
  });
  res.json(sortByDay(rows, 'day', 'period_key').map(({ class: cls, ...rest }) => ({ ...rest, class_name: cls?.name ?? rest.class_name })));
});

// GET /api/portal/teacher/my-attendance?month=2025-06
router.get('/my-attendance', ...guard, async (req, res) => {
  const { month } = req.query;
  const where = { teacher_id: tid(req) };
  if (month) where.date = { startsWith: month };
  res.json(await req.db.teacherAttendance.findMany({ where, orderBy: { date: 'desc' } }));
});

// POST /api/portal/teacher/my-attendance  (report own absence)
router.post('/my-attendance', ...guard, async (req, res) => {
  const { date, status, remarks } = req.body;
  if (!date || !status) return res.status(422).json({ error: 'date and status required' });
  await req.db.teacherAttendance.upsert({
    where: { teacher_attendance_teacher_date: { teacher_id: tid(req), date } },
    create: { id: uuid(), teacher_id: tid(req), date, status, remarks: remarks || null },
    update: { status, remarks: remarks || null },
  });
  res.status(201).json(await req.db.teacherAttendance.findFirst({ where: { teacher_id: tid(req), date } }));
});

// GET /api/portal/teacher/marks?classId=&termId=
router.get('/marks', ...guard, async (req, res) => {
  const { classId, termId } = req.query;
  if (!classId || !termId) return res.status(422).json({ error: 'classId and termId required' });
  if (!(await ownsClass(req.db, classId, tid(req)))) return res.status(403).json({ error: 'Not your class' });
  res.json(await req.db.mark.findMany({ where: { class_id: classId, term_id: termId }, orderBy: [{ student_name: 'asc' }, { subject_name: 'asc' }] }));
});

// POST /api/portal/teacher/marks  (bulk upsert)
router.post('/marks', ...guard, async (req, res) => {
  const { classId, termId, marks } = req.body;
  if (!classId || !termId || !Array.isArray(marks)) return res.status(422).json({ error: 'classId, termId, marks[] required' });
  if (!(await ownsClass(req.db, classId, tid(req)))) return res.status(403).json({ error: 'Not your class' });

  await req.db.$transaction(marks.map(m => {
    const total = (m.ca_score || 0) + (m.exam_score || 0);
    return req.db.mark.upsert({
      where: { marks_student_subject_term: { student_id: m.student_id, subject_id: m.subject_id, term_id: termId } },
      update: { ca_score: m.ca_score ?? 0, exam_score: m.exam_score ?? 0, total_score: total, grade: m.grade || null, remark: m.remark || null, updated_at: new Date() },
      create: {
        id: uuid(), student_id: m.student_id, student_name: m.student_name || null, student_number: m.student_number || null,
        subject_id: m.subject_id, subject_name: m.subject_name || null, term_id: termId, class_id: classId,
        ca_score: m.ca_score ?? 0, exam_score: m.exam_score ?? 0, total_score: total, grade: m.grade || null, remark: m.remark || null,
      },
    });
  }));
  res.json({ saved: marks.length });
});

// GET /api/portal/teacher/student-attendance?classId=&date=
router.get('/student-attendance', ...guard, async (req, res) => {
  const { classId, date } = req.query;
  if (!classId) return res.status(422).json({ error: 'classId required' });
  if (!(await ownsClass(req.db, classId, tid(req)))) return res.status(403).json({ error: 'Not your class' });
  const where = { class_id: classId };
  if (date) where.date = date;
  res.json(await req.db.attendanceRecord.findMany({ where, orderBy: { student_name: 'asc' } }));
});

// POST /api/portal/teacher/student-attendance  (bulk save)
router.post('/student-attendance', ...guard, async (req, res) => {
  const { classId, date, records } = req.body;
  if (!classId || !date || !Array.isArray(records)) return res.status(422).json({ error: 'classId, date, records[] required' });
  if (!(await ownsClass(req.db, classId, tid(req)))) return res.status(403).json({ error: 'Not your class' });

  await req.db.$transaction(records.map(r => req.db.attendanceRecord.upsert({
    where: { attendance_student_date: { student_id: r.student_id, date } },
    update: { status: r.status, remarks: r.remarks || null },
    create: {
      id: uuid(), student_id: r.student_id, student_name: r.student_name || null, student_number: r.student_number || null,
      class_id: classId, class_name: r.class_name || null, date, status: r.status, remarks: r.remarks || null,
    },
  })));
  res.json({ saved: records.length });
});

// GET /api/portal/teacher/behavior?classId=
router.get('/behavior', ...guard, async (req, res) => {
  const { classId } = req.query;
  if (classId && !(await ownsClass(req.db, classId, tid(req)))) return res.status(403).json({ error: 'Not your class' });
  const where = { teacher_id: tid(req) };
  if (classId) where.class_id = classId;
  const rows = await req.db.studentBehavior.findMany({ where, include: { student: { select: { first_name: true, last_name: true } } }, orderBy: { date: 'desc' } });
  res.json(rows.map(({ student, ...rest }) => ({ ...rest, student_name: student ? `${student.first_name} ${student.last_name}` : null })));
});

// POST /api/portal/teacher/behavior
router.post('/behavior', ...guard, async (req, res) => {
  const { student_id, class_id, date, category, description, action_taken } = req.body;
  if (!student_id || !date || !category || !description) return res.status(422).json({ error: 'student_id, date, category, description required' });
  const id = uuid();
  const created = await req.db.studentBehavior.create({
    data: { id, student_id, class_id: class_id || null, teacher_id: tid(req), date, category, description, action_taken: action_taken || null, created_by: req.user.id },
  });
  res.status(201).json(created);
});

// PUT /api/portal/teacher/behavior/:id
router.put('/behavior/:id', ...guard, async (req, res) => {
  const record = await req.db.studentBehavior.findFirst({ where: { id: req.params.id, teacher_id: tid(req) } });
  if (!record) return res.status(404).json({ error: 'Record not found or not yours' });
  const { date, category, description, action_taken } = req.body;
  const updated = await req.db.studentBehavior.update({
    where: { id: req.params.id },
    data: { date: date ?? record.date, category: category ?? record.category, description: description ?? record.description, action_taken: action_taken ?? record.action_taken, updated_at: new Date() },
  });
  res.json(updated);
});

// DELETE /api/portal/teacher/behavior/:id
router.delete('/behavior/:id', ...guard, async (req, res) => {
  const record = await req.db.studentBehavior.findFirst({ where: { id: req.params.id, teacher_id: tid(req) } });
  if (!record) return res.status(404).json({ error: 'Record not found or not yours' });
  await req.db.studentBehavior.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

// GET /api/portal/teacher/salary?month=
router.get('/salary', ...guard, async (req, res) => {
  const { month } = req.query;
  const where = { teacher_id: tid(req) };
  if (month) where.month = month;
  res.json(await req.db.teacherPayroll.findMany({ where, orderBy: { month: 'desc' } }));
});

// GET /api/portal/teacher/withdrawals
router.get('/withdrawals', ...guard, async (req, res) => {
  res.json(await req.db.salaryWithdrawal.findMany({ where: { teacher_id: tid(req) }, orderBy: { created_at: 'desc' } }));
});

// POST /api/portal/teacher/withdrawals
router.post('/withdrawals', ...guard, async (req, res) => {
  const { payroll_id, amount, reason } = req.body;
  if (!amount || amount <= 0) return res.status(422).json({ error: 'amount required and must be positive' });
  const id = uuid();
  const created = await req.db.salaryWithdrawal.create({
    data: { id, teacher_id: tid(req), payroll_id: payroll_id || null, amount, reason: reason || null },
  });
  res.status(201).json(created);
});

module.exports = router;
