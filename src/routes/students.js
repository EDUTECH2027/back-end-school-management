/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const { schemaNameFor } = require('../db/tenantSchema');
const { resolveClasses, classKey } = require('../utils/classMatching');
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
  const { search, classId, isActive, paged, page = 1, limit = 100 } = req.query;
  const where = {};
  if (search) {
    where.OR = [
      { first_name: { contains: search, mode: 'insensitive' } },
      { last_name: { contains: search, mode: 'insensitive' } },
      { student_number: { contains: search, mode: 'insensitive' } },
      { class_name: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (classId) where.class_id = classId;
  if (isActive !== undefined) where.is_active = isActive === 'true';
  const take = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const pageNo = Math.max(Number(page) || 1, 1);
  const query = {
    where, orderBy: [{ first_name: 'asc' }, { id: 'asc' }], // id keeps page boundaries stable for equal names
    take, skip: (pageNo - 1) * take,
    include: { documents: true },
  };
  // ?paged=true returns { data, total, page, limit } so a UI can show page controls over ALL matches.
  if (paged === 'true') {
    const [rows, total] = await Promise.all([req.db.student.findMany(query), req.db.student.count({ where })]);
    return res.json({ data: rows.map(parse), total, page: pageNo, limit: take });
  }
  res.json((await req.db.student.findMany(query)).map(parse));
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

  const year = new Date().getFullYear();
  let seq = await req.db.student.count();

  // Preload existing identifiers once instead of querying per row.
  const usedNumbers = new Set((await req.db.student.findMany({ select: { student_number: true } })).map(s => s.student_number));
  const usedEmails = new Set((await req.db.user.findMany({ select: { email: true } })).map(u => u.email.toLowerCase()));

  const results = { created: 0, errors: [] };
  const hash = bcrypt.hashSync(DEFAULT_STUDENT_PASSWORD, 10); // same password for all rows — hash once
  const pending = [];

  for (let i = 0; i < students.length; i++) {
    const row = students[i] || {};
    let firstName = String(row.firstName || '').trim();
    let lastName = String(row.lastName || '').trim();
    // Accept a single name (e.g. only a "Name" column): it's stored as the first name.
    if (!firstName && lastName) { firstName = lastName; lastName = ''; }
    if (!firstName) {
      results.errors.push({ row: i + 2, reason: 'Missing student name' });
      continue;
    }

    let studentNumber = String(row.studentNumber || '').trim();
    if (studentNumber) {
      if (usedNumbers.has(studentNumber)) { results.errors.push({ row: i + 2, reason: `Student number ${studentNumber} already exists` }); continue; }
    } else {
      do {
        seq += 1;
        studentNumber = `BSPS-${year}-${String(seq).padStart(3, '0')}`;
      } while (usedNumbers.has(studentNumber));
    }

    const loginEmail = `${studentNumber.toLowerCase().replace(/-/g, '')}@school.local`;
    if (usedEmails.has(loginEmail)) { results.errors.push({ row: i + 2, reason: `Login already exists for ${studentNumber}` }); continue; }
    usedNumbers.add(studentNumber);
    usedEmails.add(loginEmail);

    const clean = v => { const t = String(v ?? '').trim(); return t === '' ? null : t; };
    const gender = ['male', 'female', 'other'].includes(String(row.gender || '').trim().toLowerCase()) ? String(row.gender).trim().toLowerCase() : null;
    const isActive = row.isActive === undefined
      ? true
      : !['false', 'no', 'non', 'inactive', '0'].includes(String(row.isActive).trim().toLowerCase());

    const id = uuid();
    const fullName = `${firstName} ${lastName}`.trim();
    pending.push({
      rowNo: i + 2,
      loginEmail,
      student: {
        id, student_number: studentNumber, first_name: firstName, last_name: lastName,
        date_of_birth: clean(row.dateOfBirth), gender,
        middle_name: clean(row.middleName), address: clean(row.address), city: clean(row.city),
        mobile_number: clean(row.mobileNumber), guardian_relationship: clean(row.guardianRelationship),
        class_id: null, // filled in once the classes are resolved below
        class_name: clean(row.className),
        grade_level_name: clean(row.gradeLevelName),
        guardian_name: clean(row.guardianName), guardian_phone: clean(row.guardianPhone),
        admission_date: clean(row.admissionDate),
        is_active: isActive,
      },
      user: {
        id: uuid(), name: fullName, email: loginEmail, password_hash: hash, role: 'student',
        initials: fullName.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3),
        student_id: id, must_change_password: true,
      },
    });
  }

  // Put every student in their classroom: match the spreadsheet's class names to existing classes
  // ("FORM 1" = "Form 1" = "form one") and create the ones that don't exist yet.
  const createMissing = req.body.createMissingClasses !== false;
  const { byKey, created: createdClasses, unmatched } = await resolveClasses(
    req.db, pending.map(p => p.student.class_name).filter(Boolean), { createMissing },
  );
  let unassigned = 0;
  for (const p of pending) {
    const match = p.student.class_name ? byKey.get(classKey(p.student.class_name)) : null;
    if (match) {
      p.student.class_id = match.id;
      p.student.class_name = match.name;
      p.student.grade_level_name = match.grade_level_name || p.student.grade_level_name;
    } else unassigned++;
  }

  // Bulk insert in chunks: one transaction of 3 statements per chunk instead of ~5 queries per row.
  const CHUNK = 200;
  const createdEmails = [];
  for (let i = 0; i < pending.length; i += CHUNK) {
    const chunk = pending.slice(i, i + CHUNK);
    try {
      await req.db.$transaction(async (tx) => {
        await tx.student.createMany({ data: chunk.map(p => p.student) });
        await tx.user.createMany({ data: chunk.map(p => p.user) });
        // Raw SQL isn't schema-qualified by Prisma, so name the tenant schema explicitly (derived from a UUID, never user input).
        const schema = schemaNameFor(req.user.school_id);
        await tx.$executeRawUnsafe(
          `UPDATE "${schema}".students s SET user_id = u.id FROM "${schema}".users u WHERE u.student_id = s.id AND s.id = ANY($1::text[])`,
          chunk.map(p => p.student.id),
        );
      }, { timeout: 60000 });
      results.created += chunk.length;
      createdEmails.push(...chunk.map(p => p.loginEmail));
    } catch (err) {
      chunk.forEach(p => results.errors.push({ row: p.rowNo, reason: err.message }));
    }
  }

  if (createdEmails.length > 0) {
    try {
      await platformClient.userDirectory.createMany({
        data: createdEmails.map(email => ({ email, school_id: req.user.school_id, role: 'student' })),
        skipDuplicates: true,
      });
    } catch (err) {
      await logDirectorySyncFailure(req, 'import', `${createdEmails.length} students`, err);
    }
  }


  // Keep each touched class's headcount in sync (dashboard reads classes.enrolled).
  const touched = new Set(pending.map(p => p.student.class_id).filter(Boolean));
  for (const classId of touched) {
    const enrolled = await req.db.student.count({ where: { class_id: classId } });
    await req.db.class.update({ where: { id: classId }, data: { enrolled } }).catch(() => {});
  }

  results.classes = { created: createdClasses, unmatched, unassigned };
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
