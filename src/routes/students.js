const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const parse = row => row ? { ...row, isActive: !!row.is_active } : null;

// GET /api/students
router.get('/', authenticate, async (req, res) => {
  const { search, classId, isActive, page = 1, limit = 100 } = req.query;
  const where = {};
  if (search) {
    where.OR = [
      { first_name: { contains: search, mode: 'insensitive' } },
      { last_name: { contains: search, mode: 'insensitive' } },
      { student_number: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (classId) where.class_id = classId;
  if (isActive !== undefined) where.is_active = isActive === 'true';
  const rows = await req.db.student.findMany({
    where, orderBy: { first_name: 'asc' },
    take: Number(limit), skip: (Number(page) - 1) * Number(limit),
  });
  res.json(rows.map(parse));
});

// GET /api/students/:id
router.get('/:id', authenticate, async (req, res) => {
  const row = await req.db.student.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'Student not found' });
  res.json(parse(row));
});

// POST /api/students
router.post('/', authenticate, async (req, res) => {
  const { firstName, lastName, dateOfBirth, gender, classId, className, gradeLevelName,
          guardianName, guardianPhone, guardianRelationship, admissionDate, address } = req.body;
  if (!firstName || !lastName) return res.status(422).json({ error: 'firstName and lastName required' });

  const year = new Date().getFullYear();
  const count = (await req.db.student.count()) + 1;
  const studentNumber = `BSPS-${year}-${String(count).padStart(3, '0')}`;
  const id = uuid();

  const created = await req.db.student.create({
    data: {
      id, student_number: studentNumber, first_name: firstName, last_name: lastName,
      date_of_birth: dateOfBirth || null, gender: gender || null,
      class_id: classId || null, class_name: className || null, grade_level_name: gradeLevelName || null,
      photo_url: null, guardian_name: guardianName || null, guardian_phone: guardianPhone || null,
      guardian_relationship: guardianRelationship || null, admission_date: admissionDate || null,
      is_active: true, address: address || null,
    },
  });
  res.status(201).json(parse(created));
});

// PUT /api/students/:id
router.put('/:id', authenticate, async (req, res) => {
  const { firstName, lastName, dateOfBirth, gender, classId, className, gradeLevelName,
          guardianName, guardianPhone, guardianRelationship, admissionDate, address, isActive, photoUrl } = req.body;
  const updated = await req.db.student.update({
    where: { id: req.params.id },
    data: {
      first_name: firstName, last_name: lastName, date_of_birth: dateOfBirth || null, gender: gender || null,
      class_id: classId || null, class_name: className || null, grade_level_name: gradeLevelName || null,
      guardian_name: guardianName || null, guardian_phone: guardianPhone || null,
      guardian_relationship: guardianRelationship || null, admission_date: admissionDate || null,
      is_active: isActive !== false, address: address || null, photo_url: photoUrl || null,
      updated_at: new Date(),
    },
  });
  res.json(parse(updated));
});

// DELETE /api/students/:id  (soft delete)
router.delete('/:id', authenticate, async (req, res) => {
  await req.db.student.updateMany({ where: { id: req.params.id }, data: { is_active: false, updated_at: new Date() } });
  res.status(204).end();
});

module.exports = router;
