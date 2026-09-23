/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const platformClient = require('../../db/platformClient');
const tenantPool = require('../../db/tenantPool');
const { provisionTenantSchema, dropTenantSchema } = require('../../db/provisionTenant');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');
const { logAction } = require('./_helpers');

const guard = [authenticatePlatform, authorizePlatform()];

function generateTempPassword() {
  return `Welcome@${crypto.randomInt(1000, 9999)}`;
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

  const directoryHit = await platformClient.userDirectory.findFirst({
    where: { email: { equals: admin_email, mode: 'insensitive' } },
  });
  if (directoryHit) return res.status(409).json({ error: 'Admin email already in use by another school' });

  const plan = await platformClient.subscriptionPlan.findUnique({ where: { id: plan_id } });
  if (!plan) return res.status(422).json({ error: 'Unknown plan_id' });

  const schoolId = uuid();
  const tempPassword = generateTempPassword();

  try {
    await provisionTenantSchema(schoolId);
    const tenantDb = tenantPool.getOrOpen(schoolId);

    await tenantDb.school.create({
      data: { id: 's1', name, code: null, address: address || null, phone: phone || null, email, head_teacher: admin_name, motto: null, logo_url: null },
    });

    const adminUserId = uuid();
    const initials = admin_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3) || 'AD';
    await tenantDb.user.create({
      data: {
        id: adminUserId, name: admin_name, email: admin_email,
        password_hash: bcrypt.hashSync(tempPassword, 10),
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

  await logAction(req, 'school.created', 'school', schoolId, { name });

  const school = await platformClient.school.findUnique({ where: { id: schoolId } });
  res.status(201).json({ school, admin: { email: admin_email, tempPassword } });
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
