const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const parse = row => row ? { ...row, isActive: !!row.is_active } : null;

// GET /api/teachers
router.get('/', authenticate, async (req, res) => {
  const { search, isActive } = req.query;
  const where = {};
  if (search) {
    where.OR = [
      { first_name: { contains: search, mode: 'insensitive' } },
      { last_name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (isActive !== undefined) where.is_active = isActive === 'true';
  const rows = await req.db.teacher.findMany({ where, orderBy: { first_name: 'asc' } });
  res.json(rows.map(parse));
});

// GET /api/teachers/:id
router.get('/:id', authenticate, async (req, res) => {
  const row = await req.db.teacher.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'Teacher not found' });
  res.json(parse(row));
});

// POST /api/teachers
router.post('/', authenticate, async (req, res) => {
  const { firstName, lastName, email, phone, gender, subjects, classAssigned, qualification, joinDate } = req.body;
  if (!firstName || !lastName || !email) return res.status(422).json({ error: 'firstName, lastName and email required' });
  const id = uuid();
  const created = await req.db.teacher.create({
    data: {
      id, first_name: firstName, last_name: lastName, email, phone: phone || null, gender: gender || null,
      subjects: JSON.stringify(subjects || []), class_assigned: classAssigned || null,
      qualification: qualification || null, join_date: joinDate || null, is_active: true,
    },
  });
  res.status(201).json(parse(created));
});

// PUT /api/teachers/:id
router.put('/:id', authenticate, async (req, res) => {
  const { firstName, lastName, email, phone, gender, subjects, classAssigned, qualification, joinDate, isActive } = req.body;
  const updated = await req.db.teacher.update({
    where: { id: req.params.id },
    data: {
      first_name: firstName, last_name: lastName, email, phone: phone || null, gender: gender || null,
      subjects: JSON.stringify(subjects || []), class_assigned: classAssigned || null,
      qualification: qualification || null, join_date: joinDate || null,
      is_active: isActive !== false, updated_at: new Date(),
    },
  });
  res.json(parse(updated));
});

// DELETE /api/teachers/:id  (soft delete)
router.delete('/:id', authenticate, async (req, res) => {
  await req.db.teacher.updateMany({ where: { id: req.params.id }, data: { is_active: false, updated_at: new Date() } });
  res.status(204).end();
});

module.exports = router;
