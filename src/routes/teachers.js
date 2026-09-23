/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const authenticate = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const platformClient = require('../db/platformClient');
const { upload } = require('../utils/teacherUploads');

const DEFAULT_TEACHER_PASSWORD = 'Welcome@2025';

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
  const existingUser = await req.db.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (existingUser) return res.status(409).json({ error: 'A login already exists for this email' });
  const directoryHit = await platformClient.userDirectory.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (directoryHit) return res.status(409).json({ error: 'A login already exists for this email' });

  await req.db.$transaction(async (tx) => {
    await tx.teacher.create({
      data: {
        id, first_name: firstName, last_name: lastName, email, phone: phone || null, gender: gender || null,
        subjects: parsedSubjects, class_assigned: classAssigned || null,
        qualification: qualification || null, join_date: joinDate || null, is_active: true,
      },
    });

    const userId = uuid();
    const fullName = `${firstName} ${lastName}`;
    const initials = fullName.split(' ').map(word => word[0]).join('').toUpperCase().slice(0, 3);
    await tx.user.create({
      data: {
        id: userId, name: fullName, email, password_hash: bcrypt.hashSync(DEFAULT_TEACHER_PASSWORD, 10),
        role: 'teacher', initials, teacher_id: id,
      },
    });
    await tx.teacher.update({ where: { id }, data: { user_id: userId } });

    for (let i = 0; i < documentFiles.length; i++) {
      const file = documentFiles[i];
      const url = `/uploads/${req.user.school_id}/teachers/${file.filename}`;
      const title = parsedDocumentTitles[i] || file.originalname;
      await tx.teacherDocument.create({ data: { id: uuid(), teacher_id: id, title, file_url: url } });
    }
  });

  try {
    await platformClient.userDirectory.create({ data: { email, school_id: req.user.school_id, role: 'teacher' } });
  } catch (err) {
    console.error(`[teachers] user_directory sync failed for ${email}:`, err.message);
  }

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
