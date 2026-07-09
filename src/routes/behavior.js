const router = require('express').Router();
const { v4: uuid } = require('uuid');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');

const guard = [authenticate, authorize('super_admin', 'head_teacher', 'teacher')];

function flatten(row) {
  const { student, teacher, ...rest } = row;
  return {
    ...rest,
    student_name: student ? `${student.first_name} ${student.last_name}` : null,
    teacher_name: teacher ? `${teacher.first_name} ${teacher.last_name}` : null,
  };
}

// GET /api/behavior?studentId=&classId=
router.get('/', ...guard, async (req, res) => {
  const { studentId, classId } = req.query;
  const where = {};
  if (studentId) where.student_id = studentId;
  if (classId) where.class_id = classId;
  const rows = await req.db.studentBehavior.findMany({
    where,
    include: { student: { select: { first_name: true, last_name: true } }, teacher: { select: { first_name: true, last_name: true } } },
    orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
  });
  res.json(rows.map(flatten));
});

// POST /api/behavior
router.post('/', ...guard, async (req, res) => {
  const { student_id, class_id, teacher_id, date, category, description, action_taken } = req.body;
  if (!student_id || !date || !category || !description) {
    return res.status(422).json({ error: 'student_id, date, category, description required' });
  }
  const id = uuid();
  const created = await req.db.studentBehavior.create({
    data: { id, student_id, class_id: class_id || null, teacher_id: teacher_id || null, date, category, description, action_taken: action_taken || null, created_by: req.user.id },
  });
  res.status(201).json(created);
});

// PUT /api/behavior/:id
router.put('/:id', ...guard, async (req, res) => {
  const record = await req.db.studentBehavior.findUnique({ where: { id: req.params.id } });
  if (!record) return res.status(404).json({ error: 'Record not found' });
  const { date, category, description, action_taken } = req.body;
  const updated = await req.db.studentBehavior.update({
    where: { id: req.params.id },
    data: {
      date: date ?? record.date, category: category ?? record.category,
      description: description ?? record.description, action_taken: action_taken ?? record.action_taken,
      updated_at: new Date(),
    },
  });
  res.json(updated);
});

// DELETE /api/behavior/:id
router.delete('/:id', ...guard, async (req, res) => {
  const record = await req.db.studentBehavior.findUnique({ where: { id: req.params.id } });
  if (!record) return res.status(404).json({ error: 'Record not found' });
  await req.db.studentBehavior.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
