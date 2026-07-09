const router = require('express').Router();
const authenticate = require('../../middleware/auth');
const authorize = require('../../middleware/authorize');
const { sortByDay } = require('../../utils/dayOrder');

const guard = [authenticate, authorize('student')];
const sid = req => req.user.student_id;

// GET /api/portal/student/profile
router.get('/profile', ...guard, async (req, res) => {
  const s = await req.db.student.findUnique({ where: { id: sid(req) } });
  if (!s) return res.status(404).json({ error: 'Student profile not found' });
  res.json(s);
});

// GET /api/portal/student/marks?termId=
router.get('/marks', ...guard, async (req, res) => {
  const { termId } = req.query;
  const where = { student_id: sid(req) };
  if (termId) where.term_id = termId;
  res.json(await req.db.mark.findMany({ where, orderBy: { subject_name: 'asc' } }));
});

// GET /api/portal/student/attendance?from=&to=
router.get('/attendance', ...guard, async (req, res) => {
  const { from, to } = req.query;
  const where = { student_id: sid(req) };
  if (from || to) where.date = { ...(from && { gte: from }), ...(to && { lte: to }) };
  res.json(await req.db.attendanceRecord.findMany({ where, orderBy: { date: 'desc' } }));
});

// GET /api/portal/student/timetable
router.get('/timetable', ...guard, async (req, res) => {
  const student = await req.db.student.findUnique({ where: { id: sid(req) }, select: { class_id: true } });
  if (!student || !student.class_id) return res.json([]);
  const rows = await req.db.teacherSchedule.findMany({
    where: { class_id: student.class_id },
    include: { teacher: { select: { first_name: true, last_name: true } } },
  });
  res.json(sortByDay(rows, 'day', 'period_key').map(({ teacher, ...rest }) => ({
    ...rest, teacher_name: teacher ? `${teacher.first_name} ${teacher.last_name}` : null,
  })));
});

// GET /api/portal/student/report-cards
router.get('/report-cards', ...guard, async (req, res) => {
  const cards = await req.db.reportCard.findMany({
    where: { student_id: sid(req), status: { in: ['published', 'printed'] } },
    include: { entries: { select: { subject_name: true, total_score: true } } },
    orderBy: { created_at: 'desc' },
  });
  res.json(cards.map(({ entries, ...rest }) => ({
    ...rest,
    subjects_summary: entries.map(e => `${e.subject_name}:${e.total_score}`).join(','),
  })));
});

// GET /api/portal/student/behavior
router.get('/behavior', ...guard, async (req, res) => {
  const rows = await req.db.studentBehavior.findMany({
    where: { student_id: sid(req) },
    include: { teacher: { select: { first_name: true, last_name: true } } },
    orderBy: { date: 'desc' },
  });
  res.json(rows.map(({ teacher, ...rest }) => ({ ...rest, teacher_name: teacher ? `${teacher.first_name} ${teacher.last_name}` : null })));
});

module.exports = router;
