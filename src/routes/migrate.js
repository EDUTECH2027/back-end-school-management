const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const platformClient = require('../db/platformClient');

const DEFAULT_PASSWORD = 'Welcome@2025';

async function syncDirectory(req, email, role) {
  try {
    await platformClient.userDirectory.upsert({
      where: { email },
      create: { email, school_id: req.user.school_id, role },
      update: { school_id: req.user.school_id, role, updated_at: new Date() },
    });
  } catch (err) {
    console.error(`[migrate] user_directory sync failed for ${email}:`, err.message);
  }
}

// POST /api/migrate/portal-accounts
// Idempotent: creates portal user accounts for all teachers/students/parents that don't have one yet.
router.post('/portal-accounts', authenticate, authorize('super_admin', 'head_teacher'), async (req, res) => {
  const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
  const result = { teachers: { created: 0, skipped: 0 }, students: { created: 0, skipped: 0 }, parents: { created: 0, skipped: 0 } };
  const directorySyncs = []; // [{ email, role }] — synced after the tenant transaction commits

  await req.db.$transaction(async (tx) => {
    // ── Teachers ─────────────────────────────────────────────────────
    const teachers = await tx.teacher.findMany({ where: { is_active: true } });
    for (const t of teachers) {
      if (t.user_id) { result.teachers.skipped++; continue; }
      const email = t.email;
      const existing = await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
      if (existing) {
        await tx.teacher.update({ where: { id: t.id }, data: { user_id: existing.id, updated_at: new Date() } });
        result.teachers.skipped++;
        continue;
      }
      const userId = uuid();
      const initials = `${t.first_name[0]}${t.last_name[0]}`.toUpperCase();
      await tx.user.create({ data: { id: userId, name: `${t.first_name} ${t.last_name}`, email, password_hash: hash, role: 'teacher', initials, teacher_id: t.id } });
      await tx.teacher.update({ where: { id: t.id }, data: { user_id: userId, updated_at: new Date() } });
      directorySyncs.push({ email, role: 'teacher' });
      result.teachers.created++;
    }

    // ── Students ─────────────────────────────────────────────────────
    const students = await tx.student.findMany({ where: { is_active: true } });
    for (const s of students) {
      if (s.user_id) { result.students.skipped++; continue; }
      const email = `${s.student_number.toLowerCase().replace(/-/g, '')}@school.local`;
      const existing = await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
      if (existing) {
        await tx.student.update({ where: { id: s.id }, data: { user_id: existing.id, updated_at: new Date() } });
        result.students.skipped++;
        continue;
      }
      const userId = uuid();
      const initials = `${s.first_name[0]}${s.last_name[0]}`.toUpperCase();
      await tx.user.create({ data: { id: userId, name: `${s.first_name} ${s.last_name}`, email, password_hash: hash, role: 'student', initials, student_id: s.id } });
      await tx.student.update({ where: { id: s.id }, data: { user_id: userId, updated_at: new Date() } });
      directorySyncs.push({ email, role: 'student' });
      result.students.created++;
    }

    // ── Parents ──────────────────────────────────────────────────────
    const parents = await tx.parent.findMany();
    for (const p of parents) {
      if (p.user_id) { result.parents.skipped++; continue; }
      const email = p.email || `${p.id}@school.local`;
      const existing = await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
      if (existing) {
        await tx.parent.update({ where: { id: p.id }, data: { user_id: existing.id, updated_at: new Date() } });
        result.parents.skipped++;
        continue;
      }
      const userId = uuid();
      const initials = p.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3);
      await tx.user.create({ data: { id: userId, name: p.name, email, password_hash: hash, role: 'parent', initials, parent_id: p.id } });
      await tx.parent.update({ where: { id: p.id }, data: { user_id: userId, updated_at: new Date() } });
      directorySyncs.push({ email, role: 'parent' });
      result.parents.created++;
    }
  });

  for (const { email, role } of directorySyncs) await syncDirectory(req, email, role);

  res.json({ success: true, defaultPassword: DEFAULT_PASSWORD, result });
});

module.exports = router;
