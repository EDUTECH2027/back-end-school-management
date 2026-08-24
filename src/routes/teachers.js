const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');
const { upload } = require('../utils/teacherUploads');

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
  const rows = await req.db.teacher.findMany({ where, orderBy: { first_name: 'asc' }, include: { documents: true } });
  res.json(rows.map(parse));
});

// GET /api/teachers/:id
router.get('/:id', authenticate, async (req, res) => {
  const row = await req.db.teacher.findUnique({ where: { id: req.params.id }, include: { documents: true } });
  if (!row) return res.status(404).json({ error: 'Teacher not found' });
  res.json(parse(row));
});

// POST /api/teachers — multipart (document attachments alongside the usual fields)
router.post('/', authenticate, upload.fields([{ name: 'documents', maxCount: 10 }]), async (req, res) => {
  const { firstName, lastName, email, phone, gender, subjects, classAssigned, qualification, joinDate, documentTitles } = req.body;
  if (!firstName || !lastName || !email) return res.status(422).json({ error: 'firstName, lastName and email required' });

  let parsedSubjects = [];
  if (subjects) {
    try { parsedSubjects = JSON.parse(subjects); } catch { parsedSubjects = []; }
  }
  let parsedDocumentTitles = [];
  if (documentTitles) {
    try { parsedDocumentTitles = JSON.parse(documentTitles); } catch { parsedDocumentTitles = []; }
  }

  const id = uuid();
  const documentFiles = req.files?.documents || [];

  await req.db.$transaction(async (tx) => {
    await tx.teacher.create({
      data: {
        id, first_name: firstName, last_name: lastName, email, phone: phone || null, gender: gender || null,
        subjects: parsedSubjects, class_assigned: classAssigned || null,
        qualification: qualification || null, join_date: joinDate || null, is_active: true,
      },
    });

    for (let i = 0; i < documentFiles.length; i++) {
      const file = documentFiles[i];
      const url = `/uploads/${req.user.school_id}/teachers/${file.filename}`;
      const title = parsedDocumentTitles[i] || file.originalname;
      await tx.teacherDocument.create({ data: { id: uuid(), teacher_id: id, title, file_url: url } });
    }
  });

  const withDocs = await req.db.teacher.findUnique({ where: { id }, include: { documents: true } });
  res.status(201).json(parse(withDocs));
});

// PUT /api/teachers/:id
router.put('/:id', authenticate, async (req, res) => {
  const { firstName, lastName, email, phone, gender, subjects, classAssigned, qualification, joinDate, isActive } = req.body;
  const updated = await req.db.teacher.update({
    where: { id: req.params.id },
    data: {
      first_name: firstName, last_name: lastName, email, phone: phone || null, gender: gender || null,
      subjects: subjects || [], class_assigned: classAssigned || null,
      qualification: qualification || null, join_date: joinDate || null,
      is_active: isActive !== false, updated_at: new Date(),
    },
    include: { documents: true },
  });
  res.json(parse(updated));
});

// DELETE /api/teachers/:id  (soft delete)
router.delete('/:id', authenticate, async (req, res) => {
  await req.db.teacher.updateMany({ where: { id: req.params.id }, data: { is_active: false, updated_at: new Date() } });
  res.status(204).end();
});

module.exports = router;
