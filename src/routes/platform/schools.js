/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs/promises');
const { v4: uuid } = require('uuid');
const platformClient = require('../../db/platformClient');
const tenantPool = require('../../db/tenantPool');
const { createTenantSchema, dropTenantSchema } = require('../../db/provisionTenant');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');
const { logAction } = require('./_helpers');
const mailer = require('../../utils/mailer');
const { UPLOADS_ROOT } = require('../../utils/forumUploads');

const guard = [authenticatePlatform, authorizePlatform()];

function loginUrl() {
  const explicit = process.env.APP_LOGIN_URL || process.env.FRONTEND_URL;
  return (explicit || require('../../config/env').CORS_ALLOWED_ORIGINS[0] || '').replace(/\/$/, '');
}

// Email the administrator their platform URL + first-login credentials and audit the outcome.
// Never throws and never writes the password to the audit log.
async function emailAdminCredentials(req, { schoolId, schoolName, adminName, adminEmail, tempPassword }) {
  let result;
  try {
    result = await mailer.sendSchoolCredentialsEmail({
      to: adminEmail, adminName, schoolName, loginUrl: loginUrl(), tempPassword,
    });
  } catch (e) {
    result = { ok: false, code: 'UNEXPECTED', error: e.message };
  }
  await logAction(req, result.ok ? 'school.credentials_email_sent' : 'school.credentials_email_failed', 'school', schoolId, {
    to: adminEmail, message_id: result.messageId, code: result.code, error: result.error,
  }).catch(() => {});
  return result;
}

function emailSummary(r) {
  return r.ok
    ? { sent: true, message_id: r.messageId }
    : { sent: false, error: r.error, code: r.code, retryable: !!r.retryable };
}

async function withLiveCounts(school) {
  try {
    const tenantDb = tenantPool.getOrOpen(school.id);
    const [students, teachers] = await Promise.all([
      tenantDb.student.count({ where: { is_active: true } }),
      tenantDb.teacher.count({ where: { is_active: true } }),
    ]);
    return { ...school, students, teachers };
  } catch {
    return { ...school, students: 0, teachers: 0 };
  }
}

// GET /api/platform/schools
router.get('/', ...guard, async (req, res) => {
  const schools = await platformClient.school.findMany({
    include: { plan: { select: { name: true, price: true } } },
    orderBy: { created_at: 'desc' },
  });
  const rows = schools.map(s => ({ ...s, plan_name: s.plan?.name ?? null, plan_price: s.plan?.price ?? null, plan: undefined }));
  res.json(await Promise.all(rows.map(withLiveCounts)));
});

// GET /api/platform/schools/:id
router.get('/:id', ...guard, async (req, res) => {
  const school = await platformClient.school.findUnique({
    where: { id: req.params.id },
    include: { plan: { select: { name: true, price: true } } },
  });
  if (!school) return res.status(404).json({ error: 'School not found' });
  const { plan, ...rest } = school;
  res.json(await withLiveCounts({ ...rest, plan_name: plan?.name ?? null, plan_price: plan?.price ?? null }));
});

// GET /api/platform/schools/:id/summary — narrow read-only drill-in, never the full tenant CRUD surface
router.get('/:id/summary', ...guard, async (req, res) => {
  const school = await platformClient.school.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!school) return res.status(404).json({ error: 'School not found' });

  const tenantDb = tenantPool.getOrOpen(req.params.id);
  const [students, teachers, classes, recentAnnouncements, fees] = await Promise.all([
    tenantDb.student.count({ where: { is_active: true } }),
    tenantDb.teacher.count({ where: { is_active: true } }),
    tenantDb.class.count(),
    tenantDb.announcement.findMany({ select: { title: true, created_at: true }, orderBy: { created_at: 'desc' }, take: 5 }),
    tenantDb.feeRecord.aggregate({ _sum: { amount_paid: true, balance: true } }),
  ]);
  res.json({
    students, teachers, classes, recentAnnouncements,
    fees: { collected: fees._sum.amount_paid, pending: fees._sum.balance },
  });
});

// POST /api/platform/schools — provisions a brand new isolated tenant
router.post('/', ...guard, async (req, res) => {
  const { name, phone, address, plan_id, admin_name } = req.body;
  const email = req.body.email?.trim();
  const admin_email = req.body.admin_email?.trim();
  if (!name || !email || !plan_id || !admin_name || !admin_email) {
    return res.status(422).json({ error: 'name, email, plan_id, admin_name, admin_email are required' });
  }

  // The two checks are independent, so run them together (each is a round trip to a remote database).
  const [directoryHit, plan] = await Promise.all([
    platformClient.userDirectory.findFirst({ where: { email: { equals: admin_email, mode: 'insensitive' } } }),
    platformClient.subscriptionPlan.findUnique({ where: { id: plan_id } }),
  ]);
  if (directoryHit) return res.status(409).json({ error: 'Admin email already in use by another school' });
  if (!plan) return res.status(422).json({ error: 'Unknown plan_id' });

  const schoolId = uuid();
  const tempPassword = mailer.generateTempPassword();
  const adminUserId = uuid();
  const passwordHash = bcrypt.hashSync(tempPassword, 10);

  try {
    await createTenantSchema(schoolId); // fast path (~2 s); falls back to prisma migrate deploy
    const tenantDb = tenantPool.getOrOpen(schoolId);

    await tenantDb.school.create({
      data: { id: 's1', name, code: null, address: address || null, phone: phone || null, email, head_teacher: admin_name, motto: null, logo_url: null },
    });

    const initials = admin_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3) || 'AD';
    await tenantDb.user.create({
      data: {
        id: adminUserId, name: admin_name, email: admin_email,
        password_hash: passwordHash,
        role: 'super_admin', initials, must_change_password: true,
      },
    });
  } catch (e) {
    await dropTenantSchema(schoolId);
    return res.status(500).json({ error: 'Failed to provision school database', detail: e.message });
  }

  try {
    await platformClient.$transaction([
      platformClient.school.create({
        data: {
          id: schoolId, name, code: null, address: address || null, phone: phone || null, email,
          admin_name, admin_email, plan_id, status: 'active', subscription_expiry: null,
        },
      }),
      platformClient.userDirectory.create({
        data: { email: admin_email, school_id: schoolId, role: 'super_admin' },
      }),
    ]);
  } catch (e) {
    await dropTenantSchema(schoolId);
    return res.status(500).json({ error: 'Failed to register school', detail: e.message });
  }

  // The school is now fully created. Audit log, reading it back and the welcome email don't depend on
  // each other, so do them together instead of one after another. An email failure never undoes the school.
  const [, school, mail] = await Promise.all([
    logAction(req, 'school.created', 'school', schoolId, { name }),
    platformClient.school.findUnique({ where: { id: schoolId } }),
    emailAdminCredentials(req, {
      schoolId, schoolName: name, adminName: admin_name, adminEmail: admin_email, tempPassword,
    }),
  ]);

  // The temporary password is returned to the platform admin ONLY when the email could not be
  // sent, so they can hand it over by hand; otherwise it exists nowhere but the admin's inbox.
  res.status(201).json({
    school,
    admin: mail.ok ? { email: admin_email } : { email: admin_email, tempPassword },
    email: emailSummary(mail),
  });
});

// GET /api/platform/schools/:id/credentials-status — outcome of the latest credentials email.
router.get('/:id/credentials-status', ...guard, async (req, res) => {
  const last = await platformClient.systemLog.findFirst({
    where: { target_id: req.params.id, action: { startsWith: 'school.credentials_email' } },
    orderBy: { created_at: 'desc' },
  });
  if (!last) return res.json({ state: 'none' });
  let m = last.meta; if (typeof m === 'string') { try { m = JSON.parse(m); } catch { m = {}; } }
  const sent = last.action === 'school.credentials_email_sent';
  res.json({ state: sent ? 'sent' : 'failed', at: last.created_at, to: m?.to, ...(sent ? {} : { error: m?.error, code: m?.code }) });
});

// POST /api/platform/schools/:id/resend-credentials — sets a NEW temporary password (the old one stops
// working, existing sessions are revoked) and emails it to the administrator.
router.post('/:id/resend-credentials', ...guard, async (req, res) => {
  const school = await platformClient.school.findUnique({ where: { id: req.params.id } });
  if (!school) return res.status(404).json({ error: 'School not found' });

  const tenantDb = tenantPool.getOrOpen(school.id);
  const admin = await tenantDb.user.findFirst({ where: { email: { equals: school.admin_email, mode: 'insensitive' } } });
  if (!admin) return res.status(404).json({ error: 'School administrator account not found' });

  const tempPassword = mailer.generateTempPassword();
  await tenantDb.user.update({
    where: { id: admin.id },
    data: { password_hash: bcrypt.hashSync(tempPassword, 10), must_change_password: true },
  });
  await require('../../auth/tokens').revokeAllForSchool(school.id).catch(() => {});

  const mail = await emailAdminCredentials(req, {
    schoolId: school.id, schoolName: school.name, adminName: school.admin_name,
    adminEmail: school.admin_email, tempPassword,
  });
  res.json({
    admin: mail.ok ? { email: school.admin_email } : { email: school.admin_email, tempPassword },
    email: emailSummary(mail),
  });
});

// DELETE /api/platform/schools/:id — PERMANENTLY removes a school: its whole database schema, its
// registry/login rows, its sessions and its uploaded files. Irreversible, so the caller must type the
// school's exact name (body: { confirm_name }) — a stray click or a stale tab cannot delete anything.
router.delete('/:id', ...guard, async (req, res) => {
  const school = await platformClient.school.findUnique({ where: { id: req.params.id } });
  if (!school) return res.status(404).json({ error: 'School not found' });

  const typed = String(req.body?.confirm_name ?? '').trim();
  if (typed !== school.name.trim()) {
    return res.status(422).json({ error: 'Confirmation does not match: type the school name exactly to delete it.' });
  }

  // For the audit trail only (best effort — never blocks the deletion).
  const counts = await withLiveCounts({ id: school.id });

  // 1. Registry first, in one transaction: the school disappears from the app and nobody can log into it.
  try {
    await platformClient.$transaction([
      platformClient.authRefreshToken.deleteMany({ where: { school_id: school.id } }),
      platformClient.userDirectory.deleteMany({ where: { school_id: school.id } }),
      platformClient.school.delete({ where: { id: school.id } }),
    ]);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to delete school', detail: e.message });
  }

  // 2. Then free the space: drop the school's schema (all its tables and data) and its uploaded files.
  const schemaDropped = await dropTenantSchema(school.id);
  let filesRemoved = true;
  if (/^[0-9a-f-]{36}$/i.test(school.id)) { // ids are UUIDs; refuse anything else so the path can never escape uploads/
    const dir = path.join(UPLOADS_ROOT, school.id);
    try { await fs.rm(dir, { recursive: true, force: true }); } catch (e) { filesRemoved = false; console.error(`[school delete] could not remove ${dir}:`, e.message); }
  }

  await logAction(req, 'school.deleted', 'school', school.id, {
    name: school.name, admin_email: school.admin_email,
    students: counts.students, teachers: counts.teachers, schema_dropped: schemaDropped, files_removed: filesRemoved,
  }).catch(() => {});

  res.json({ deleted: true, schema_dropped: schemaDropped, files_removed: filesRemoved });
});

// PUT /api/platform/schools/:id
router.put('/:id', ...guard, async (req, res) => {
  const current = await platformClient.school.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: 'School not found' });

  const { name, address, phone, email, plan_id, subscription_expiry } = req.body;
  const updated = await platformClient.school.update({
    where: { id: req.params.id },
    data: {
      name: name ?? current.name,
      address: address ?? current.address,
      phone: phone ?? current.phone,
      email: email ?? current.email,
      plan_id: plan_id ?? current.plan_id,
      subscription_expiry: subscription_expiry ?? current.subscription_expiry,
      updated_at: new Date(),
    },
  });

  await logAction(req, 'school.updated', 'school', req.params.id, {});
  res.json(updated);
});

// PATCH /api/platform/schools/:id/activate
router.patch('/:id/activate', ...guard, async (req, res) => {
  const school = await platformClient.school.findUnique({ where: { id: req.params.id } });
  if (!school) return res.status(404).json({ error: 'School not found' });
  const updated = await platformClient.school.update({
    where: { id: req.params.id },
    data: { status: 'active', updated_at: new Date() },
  });
  await logAction(req, 'school.activated', 'school', req.params.id, {});
  res.json(updated);
});

// PATCH /api/platform/schools/:id/deactivate
router.patch('/:id/deactivate', ...guard, async (req, res) => {
  const school = await platformClient.school.findUnique({ where: { id: req.params.id } });
  if (!school) return res.status(404).json({ error: 'School not found' });
  const updated = await platformClient.school.update({
    where: { id: req.params.id },
    data: { status: 'inactive', updated_at: new Date() },
  });
  // Force every user of this school out immediately (their access tokens are
  // also rejected by middleware/auth.js on the school-status check, but this
  // kills refresh tokens so they can't bounce back after re-activation).
  await require('../../auth/tokens').revokeAllForSchool(req.params.id).catch(() => {});
  await logAction(req, 'school.deactivated', 'school', req.params.id, {});
  res.json(updated);
});

module.exports = router;
