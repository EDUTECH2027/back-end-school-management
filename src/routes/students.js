const router = require('express').Router();
const authenticate = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const platformClient = require('../db/platformClient');
const { upload } = require('../utils/studentUploads');

const parse = row => row ? { ...row, isActive: !!row.is_active } : null;

// Best-effort compensation for the platform.user_directory write that can't share
// a transaction with the tenant-side write (two separate Prisma connections) —
// same pattern as backend/src/routes/users.js.
async function logDirectorySyncFailure(req, action, email, err) {
  console.error(`[students] user_directory sync failed after ${action} for ${email}:`, err.message);
  try {
    await platformClient.systemLog.create({
      data: {
        id: uuid(), actor_type: 'platform_admin', actor_id: req.user?.id || null, actor_name: req.user?.name || null,
        action: 'user_directory.sync_failed', target_type: 'user', target_id: email,
        meta: JSON.stringify({ action, error: err.message }),
      },
    });
  } catch (logErr) {
    console.error('[students] failed to even log the sync failure:', logErr.message);
  }
}

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
    include: { documents: true },
  });
  res.json(rows.map(parse));
});

// GET /api/students/:id
router.get('/:id', authenticate, async (req, res) => {
  const row = await req.db.student.findUnique({ where: { id: req.params.id }, include: { documents: true } });
  if (!row) return res.status(404).json({ error: 'Student not found' });
  res.json(parse(row));
});

// Matches DEFAULT_PASSWORD in routes/migrate.js and the email pattern the
// EDUTECH Login page's Student-ID tab derives from a Student ID
// (studentEmailFor() in src/pages/Login.tsx) — every student needs a portal
// login the moment they're created so that pattern always resolves.
const DEFAULT_STUDENT_PASSWORD = 'Welcome@2025';

// POST /api/students — multipart (photo + document files alongside the usual fields)
router.post('/', authenticate, upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'documents', maxCount: 10 }]), async (req, res) => {
  const {
    firstName, middleName, lastName, dateOfBirth, gender,
    classId, className, gradeLevelName,
    address, city, state, zipCode, mobileNumber, alternateMobileNumber,
    guardianName, guardianPhone, guardianRelationship, admissionDate,
    siblingIds, documentTitles,
  } = req.body;
  if (!firstName || !lastName) return res.status(422).json({ error: 'firstName and lastName required' });

  let parsedSiblingIds = [];
  if (siblingIds) {
    try { parsedSiblingIds = JSON.parse(siblingIds); } catch { parsedSiblingIds = []; }
  }

  const year = new Date().getFullYear();
  const count = (await req.db.student.count()) + 1;
  const studentNumber = `BSPS-${year}-${String(count).padStart(3, '0')}`;
  const id = uuid();
  const loginEmail = `${studentNumber.toLowerCase().replace(/-/g, '')}@school.local`;

  const existing = await req.db.user.findFirst({ where: { email: { equals: loginEmail, mode: 'insensitive' } } });
  if (existing) return res.status(409).json({ error: 'A login already exists for this student number' });

  const photoFile = req.files?.photo?.[0];
  const documentFiles = req.files?.documents || [];
  const photoUrl = photoFile ? `/uploads/${req.user.school_id}/students/${photoFile.filename}` : null;
  let parsedDocumentTitles = [];
  if (documentTitles) {
    try { parsedDocumentTitles = JSON.parse(documentTitles); } catch { parsedDocumentTitles = []; }
  }

  try {
    await req.db.$transaction(async (tx) => {
      await tx.student.create({
        data: {
          id, student_number: studentNumber, first_name: firstName, middle_name: middleName || null, last_name: lastName,
          date_of_birth: dateOfBirth || null, gender: gender || null,
          class_id: classId || null, class_name: className || null, grade_level_name: gradeLevelName || null,
          photo_url: photoUrl,
          address: address || null, city: city || null, state: state || null, zip_code: zipCode || null,
          mobile_number: mobileNumber || null, alternate_mobile_number: alternateMobileNumber || null,
          sibling_ids: parsedSiblingIds,
          guardian_name: guardianName || null, guardian_phone: guardianPhone || null,
          guardian_relationship: guardianRelationship || null, admission_date: admissionDate || null,
          is_active: true,
        },
      });

      for (let i = 0; i < documentFiles.length; i++) {
        const file = documentFiles[i];
        const url = `/uploads/${req.user.school_id}/students/${file.filename}`;
        const title = parsedDocumentTitles[i] || file.originalname;
        await tx.studentDocument.create({ data: { id: uuid(), student_id: id, title, file_url: url } });
      }

      const createdUserId = uuid();
      const hash = bcrypt.hashSync(DEFAULT_STUDENT_PASSWORD, 10);
      const fullName = `${firstName} ${lastName}`;
      const initials = fullName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3);
      await tx.user.create({
        data: { id: createdUserId, name: fullName, email: loginEmail, password_hash: hash, role: 'student', initials, student_id: id, must_change_password: true },
      });
      await tx.student.update({ where: { id }, data: { user_id: createdUserId } });
    });
  } catch (err) {
    console.error('[POST /students]', err.message);
    return res.status(500).json({ error: err.message });
  }

  try {
    await platformClient.userDirectory.create({ data: { email: loginEmail, school_id: req.user.school_id, role: 'student' } });
  } catch (err) {
    await logDirectorySyncFailure(req, 'create', loginEmail, err);
  }

  // Best-effort bidirectional sibling linking — not worth failing student
  // creation over, so each link is independent and logged rather than thrown.
  for (const siblingId of parsedSiblingIds) {
    try {
      const sibling = await req.db.student.findUnique({ where: { id: siblingId }, select: { sibling_ids: true } });
      if (!sibling) continue;
      const existingIds = Array.isArray(sibling.sibling_ids) ? sibling.sibling_ids : [];
      if (!existingIds.includes(id)) {
        await req.db.student.update({ where: { id: siblingId }, data: { sibling_ids: [...existingIds, id] } });
      }
    } catch (err) {
      console.error(`[students] failed to back-link sibling ${siblingId}:`, err.message);
    }
  }

  const withDocs = await req.db.student.findUnique({ where: { id }, include: { documents: true } });
  res.status(201).json(parse(withDocs));
});

// POST /api/students/import — bulk-create students from parsed CSV/spreadsheet rows.
// Each row is best-effort: a bad row is reported in `errors` and skipped rather than
// aborting the whole batch, since a 500-row sheet with one typo shouldn't lose the other 499.
router.post('/import', authenticate, async (req, res) => {
  const { students } = req.body;
  if (!Array.isArray(students) || students.length === 0) {
    return res.status(422).json({ error: 'students array required' });
  }

  const classes = await req.db.class.findMany({ select: { id: true, name: true, grade_level_name: true } });
  const classByName = new Map(classes.map(c => [c.name.trim().toLowerCase(), c]));

  const year = new Date().getFullYear();
  let seq = await req.db.student.count();

  const results = { created: 0, errors: [] };

  for (let i = 0; i < students.length; i++) {
    const row = students[i] || {};
    const firstName = String(row.firstName || '').trim();
    const lastName = String(row.lastName || '').trim();
    if (!firstName || !lastName) {
      results.errors.push({ row: i + 2, reason: 'Missing first or last name' });
      continue;
    }

    const matchedClass = row.className ? classByName.get(String(row.className).trim().toLowerCase()) : null;

    let studentNumber = String(row.studentNumber || '').trim();
    if (studentNumber) {
      const dup = await req.db.student.findFirst({ where: { student_number: studentNumber } });
      if (dup) { results.errors.push({ row: i + 2, reason: `Student number ${studentNumber} already exists` }); continue; }
    } else {
      do {
        seq += 1;
        studentNumber = `BSPS-${year}-${String(seq).padStart(3, '0')}`;
      // eslint-disable-next-line no-await-in-loop
      } while (await req.db.student.findFirst({ where: { student_number: studentNumber } }));
    }

    const loginEmail = `${studentNumber.toLowerCase().replace(/-/g, '')}@school.local`;
    const existingUser = await req.db.user.findFirst({ where: { email: { equals: loginEmail, mode: 'insensitive' } } });
    if (existingUser) { results.errors.push({ row: i + 2, reason: `Login already exists for ${studentNumber}` }); continue; }

    const isActive = row.isActive === undefined
      ? true
      : !['false', 'no', 'non', 'inactive', '0'].includes(String(row.isActive).trim().toLowerCase());

    const id = uuid();
    try {
      await req.db.$transaction(async (tx) => {
        await tx.student.create({
          data: {
            id, student_number: studentNumber, first_name: firstName, last_name: lastName,
            date_of_birth: row.dateOfBirth || null, gender: row.gender || null,
            class_id: matchedClass?.id || null,
            class_name: matchedClass?.name || row.className || null,
            grade_level_name: matchedClass?.grade_level_name || row.gradeLevelName || null,
            guardian_name: row.guardianName || null, guardian_phone: row.guardianPhone || null,
            admission_date: row.admissionDate || null,
            is_active: isActive,
          },
        });

        const createdUserId = uuid();
        const hash = bcrypt.hashSync(DEFAULT_STUDENT_PASSWORD, 10);
        const fullName = `${firstName} ${lastName}`;
        const initials = fullName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3);
        await tx.user.create({
          data: { id: createdUserId, name: fullName, email: loginEmail, password_hash: hash, role: 'student', initials, student_id: id, must_change_password: true },
        });
        await tx.student.update({ where: { id }, data: { user_id: createdUserId } });
      });
      results.created += 1;
      try {
        await platformClient.userDirectory.create({ data: { email: loginEmail, school_id: req.user.school_id, role: 'student' } });
      } catch (err) {
        await logDirectorySyncFailure(req, 'import', loginEmail, err);
      }
    } catch (err) {
      results.errors.push({ row: i + 2, reason: err.message });
    }
  }

  res.status(201).json(results);
});

// PUT /api/students/:id
router.put('/:id', authenticate, async (req, res) => {
  const { firstName, middleName, lastName, dateOfBirth, gender, classId, className, gradeLevelName,
          address, city, state, zipCode, mobileNumber, alternateMobileNumber,
          guardianName, guardianPhone, guardianRelationship, admissionDate, isActive, photoUrl, siblingIds } = req.body;
  const updated = await req.db.student.update({
    where: { id: req.params.id },
    data: {
      first_name: firstName, middle_name: middleName || null, last_name: lastName,
      date_of_birth: dateOfBirth || null, gender: gender || null,
      class_id: classId || null, class_name: className || null, grade_level_name: gradeLevelName || null,
      address: address || null, city: city || null, state: state || null, zip_code: zipCode || null,
      mobile_number: mobileNumber || null, alternate_mobile_number: alternateMobileNumber || null,
      guardian_name: guardianName || null, guardian_phone: guardianPhone || null,
      guardian_relationship: guardianRelationship || null, admission_date: admissionDate || null,
      is_active: isActive !== false, photo_url: photoUrl || null,
      ...(siblingIds !== undefined && { sibling_ids: siblingIds }),
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
