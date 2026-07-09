const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');
const { sortByDay } = require('../utils/dayOrder');

const flattenTeacher = row => {
  const { teacher, ...rest } = row;
  return { ...rest, first_name: teacher?.first_name ?? null, last_name: teacher?.last_name ?? null };
};

// GET /api/timetable?teacherId=tc1&classId=c1&day=monday
router.get('/', authenticate, async (req, res) => {
  const { teacherId, classId, day } = req.query;
  const where = {};
  if (teacherId) where.teacher_id = teacherId;
  if (classId) where.class_id = classId;
  if (day) where.day = day;
  const rows = await req.db.teacherSchedule.findMany({ where, include: { teacher: { select: { first_name: true, last_name: true } } } });
  res.json(sortByDay(rows, 'day', 'period_key').map(flattenTeacher));
});

// POST /api/timetable
router.post('/', authenticate, async (req, res) => {
  const { teacherId, day, periodKey, periodLabel, time, classId, className, subjectName, room } = req.body;
  if (!day || !periodKey || !classId || !subjectName) return res.status(422).json({ error: 'Missing required fields' });
  const id = uuid();
  const created = await req.db.teacherSchedule.create({
    data: { id, teacher_id: teacherId || null, day, period_key: periodKey, period_label: periodLabel || null, time: time || null, class_id: classId, class_name: className || null, subject_name: subjectName, room: room || null },
    include: { teacher: { select: { first_name: true, last_name: true } } },
  });
  res.status(201).json(flattenTeacher(created));
});

// PUT /api/timetable/:id
router.put('/:id', authenticate, async (req, res) => {
  const { teacherId, day, periodKey, periodLabel, time, classId, className, subjectName, room } = req.body;
  const updated = await req.db.teacherSchedule.update({
    where: { id: req.params.id },
    data: { teacher_id: teacherId, day, period_key: periodKey, period_label: periodLabel || null, time: time || null, class_id: classId, class_name: className || null, subject_name: subjectName, room: room || null },
  });
  res.json(updated);
});

// DELETE /api/timetable/:id
router.delete('/:id', authenticate, async (req, res) => {
  await req.db.teacherSchedule.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
