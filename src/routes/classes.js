const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

router.get('/', authenticate, async (req, res) => {
  const { grade_level_id } = req.query;
  const where = grade_level_id ? { grade_level_id } : {};
  res.json(await req.db.class.findMany({ where, orderBy: { name: 'asc' } }));
});

router.get('/:id', authenticate, async (req, res) => {
  const row = await req.db.class.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'Class not found' });
  res.json(row);
});

router.post('/', authenticate, async (req, res) => {
  const { grade_level_id, grade_level_name, name, capacity, room, class_teacher_id, class_teacher_name } = req.body;
  if (!name) return res.status(422).json({ error: 'name required' });
  const id = uuid();
  const created = await req.db.class.create({
    data: {
      id, grade_level_id: grade_level_id || null, grade_level_name: grade_level_name || null, name,
      capacity: capacity || 40, room: room || null,
      class_teacher_id: class_teacher_id || null, class_teacher_name: class_teacher_name || null, enrolled: 0,
    },
  });
  res.status(201).json(created);
});

router.put('/:id', authenticate, async (req, res) => {
  const { grade_level_id, grade_level_name, name, capacity, room, class_teacher_id, class_teacher_name, enrolled } = req.body;
  const updated = await req.db.class.update({
    where: { id: req.params.id },
    data: {
      grade_level_id, grade_level_name, name, capacity, room: room || null,
      class_teacher_id: class_teacher_id || null, class_teacher_name: class_teacher_name || null,
      enrolled: enrolled || 0,
    },
  });
  res.json(updated);
});

router.delete('/:id', authenticate, async (req, res) => {
  await req.db.class.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

// GET /api/classes/:id/students
router.get('/:id/students', authenticate, async (req, res) => {
  const rows = await req.db.student.findMany({
    where: { class_id: req.params.id, is_active: true },
    orderBy: { first_name: 'asc' },
  });
  res.json(rows);
});

module.exports = router;
