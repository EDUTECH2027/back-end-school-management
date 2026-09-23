/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const platformClient = require('../db/platformClient');
const { logAction } = require('../routes/platform/_helpers');

const guard = [authenticate, authorize('super_admin', 'head_teacher')];

const PUBLIC_FIELDS = { id: true, name: true, email: true, role: true, initials: true, teacher_id: true, student_id: true, parent_id: true, created_at: true };

// Best-effort compensation for the platform.user_directory write that can't share
// a transaction with the tenant-side write (two separate Prisma connections).
// Not full atomicity — see multitenant-architecture plan notes — but an
// improvement over the old two-SQLite-files version, which tracked nothing.
async function logDirectorySyncFailure(req, action, email, err) {
  console.error(`[users] user_directory sync failed after ${action} for ${email}:`, err.message);
  try {
    await platformClient.systemLog.create({
      data: {
        id: uuid(), actor_type: 'platform_admin', actor_id: req.user?.id || null, actor_name: req.user?.name || null,
        action: 'user_directory.sync_failed', target_type: 'user', target_id: email,
        meta: JSON.stringify({ action, error: err.message }),
      },
    });
  } catch (logErr) {
    console.error('[users] failed to even log the sync failure:', logErr.message);
  }
}

// GET /api/users
router.get('/', ...guard, async (req, res) => {
  res.json(await req.db.user.findMany({ select: PUBLIC_FIELDS, orderBy: { name: 'asc' } }));
});

// GET /api/users/:id
router.get('/:id', ...guard, async (req, res) => {
  const user = await req.db.user.findUnique({ where: { id: req.params.id }, select: PUBLIC_FIELDS });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// POST /api/users
router.post('/', ...guard, async (req, res) => {
  const { name, email, password, role, initials, teacher_id, student_id, parent_id } = req.body;
  if (!name || !email || !password || !role) return res.status(422).json({ error: 'name, email, password, role required' });

  const existing = await req.db.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (existing) return res.status(409).json({ error: 'Email already in use' });
  const directoryHit = await platformClient.userDirectory.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (directoryHit) return res.status(409).json({ error: 'Email already in use' });

  const id = uuid();
  const hash = bcrypt.hashSync(password, 10);
  const ini = initials || name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3);

  await req.db.$transaction(async (tx) => {
    await tx.user.create({
      data: { id, name, email, password_hash: hash, role, initials: ini, teacher_id: teacher_id || null, student_id: student_id || null, parent_id: parent_id || null },
    });
    if (teacher_id) await tx.teacher.update({ where: { id: teacher_id }, data: { user_id: id, updated_at: new Date() } });
    if (student_id) await tx.student.update({ where: { id: student_id }, data: { user_id: id, updated_at: new Date() } });
    if (parent_id) await tx.parent.update({ where: { id: parent_id }, data: { user_id: id, updated_at: new Date() } });
  });

  try {
    await platformClient.userDirectory.create({ data: { email, school_id: req.user.school_id, role } });
  } catch (err) {
    await logDirectorySyncFailure(req, 'create', email, err);
  }

  const user = await req.db.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
  res.status(201).json(user);
});

// PUT /api/users/:id
router.put('/:id', ...guard, async (req, res) => {
  const { name, email, role, initials, teacher_id, student_id, parent_id } = req.body;
  const current = await req.db.user.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: 'User not found' });

  const newEmail = email ?? current.email;
  const newRole = role ?? current.role;

  await req.db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: req.params.id },
      data: {
        name: name ?? current.name, email: newEmail, role: newRole, initials: initials ?? current.initials,
        teacher_id: teacher_id ?? current.teacher_id, student_id: student_id ?? current.student_id, parent_id: parent_id ?? current.parent_id,
        updated_at: new Date(),
      },
    });
    if (teacher_id !== undefined) await tx.teacher.update({ where: { id: teacher_id }, data: { user_id: req.params.id, updated_at: new Date() } });
    if (student_id !== undefined) await tx.student.update({ where: { id: student_id }, data: { user_id: req.params.id, updated_at: new Date() } });
    if (parent_id !== undefined) await tx.parent.update({ where: { id: parent_id }, data: { user_id: req.params.id, updated_at: new Date() } });
  });

  try {
    if (newEmail !== current.email) {
      await platformClient.userDirectory.deleteMany({ where: { email: current.email } });
      await platformClient.userDirectory.upsert({
        where: { email: newEmail },
        create: { email: newEmail, school_id: req.user.school_id, role: newRole },
        update: { school_id: req.user.school_id, role: newRole, updated_at: new Date() },
      });
    } else {
      await platformClient.userDirectory.updateMany({ where: { email: newEmail }, data: { role: newRole, updated_at: new Date() } });
    }
  } catch (err) {
    await logDirectorySyncFailure(req, 'update', newEmail, err);
  }

  res.json(await req.db.user.findUnique({ where: { id: req.params.id }, select: PUBLIC_FIELDS }));
});

// PATCH /api/users/:id/password
router.patch('/:id/password', ...guard, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(422).json({ error: 'Password must be at least 6 characters' });
  const user = await req.db.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  const hash = bcrypt.hashSync(password, 10);
  await req.db.user.update({ where: { id: req.params.id }, data: { password_hash: hash, updated_at: new Date() } });
  res.json({ message: 'Password updated' });
});

// DELETE /api/users/:id
router.delete('/:id', ...guard, async (req, res) => {
  const user = await req.db.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  await req.db.$transaction(async (tx) => {
    if (user.teacher_id) await tx.teacher.update({ where: { id: user.teacher_id }, data: { user_id: null, updated_at: new Date() } });
    if (user.student_id) await tx.student.update({ where: { id: user.student_id }, data: { user_id: null, updated_at: new Date() } });
    if (user.parent_id) await tx.parent.update({ where: { id: user.parent_id }, data: { user_id: null, updated_at: new Date() } });
    await tx.user.delete({ where: { id: req.params.id } });
  });

  try {
    await platformClient.userDirectory.deleteMany({ where: { email: user.email } });
  } catch (err) {
    await logDirectorySyncFailure(req, 'delete', user.email, err);
  }

  res.status(204).end();
});

module.exports = router;
