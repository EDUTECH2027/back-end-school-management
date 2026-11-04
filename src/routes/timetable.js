/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
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

// A teacher can only be in one class per day+period. Returns the slot that already occupies the
// teacher (with its class) or null. Slots of the SAME class are ignored: the grid editor replaces
// a class's slots wholesale, so those are never a clash.
async function findTeacherConflict(db, { teacherId, day, periodKey, classId, excludeId }) {
  if (!teacherId || !day || !periodKey) return null;
  return db.teacherSchedule.findFirst({
    where: {
      teacher_id: teacherId, day, period_key: periodKey,
      ...(classId ? { class_id: { not: classId } } : {}),
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    include: { class: { select: { name: true } }, teacher: { select: { first_name: true, last_name: true } } },
  });
}

const conflictResponse = (res, c) => {
  const className = c.class?.name ?? c.class_name ?? 'another class';
  const teacherName = c.teacher ? `${c.teacher.first_name} ${c.teacher.last_name}` : 'This teacher';
  return res.status(409).json({
    error: `${teacherName} is already teaching ${className} (${c.subject_name}) at this period.`,
    conflict: { class_id: c.class_id, class_name: className, subject_name: c.subject_name, day: c.day, period_key: c.period_key, teacher_id: c.teacher_id },
  });
};

// POST /api/timetable
router.post('/', authenticate, async (req, res) => {
  const { teacherId, day, periodKey, periodLabel, time, classId, className, subjectName, room } = req.body;
  if (!day || !periodKey || !classId || !subjectName) return res.status(422).json({ error: 'Missing required fields' });
  const conflict = await findTeacherConflict(req.db, { teacherId, day, periodKey, classId });
  if (conflict) return conflictResponse(res, conflict);
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
  const conflict = await findTeacherConflict(req.db, { teacherId, day, periodKey, classId, excludeId: req.params.id });
  if (conflict) return conflictResponse(res, conflict);
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
