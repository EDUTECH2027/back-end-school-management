const router = require('express').Router();
const fs = require('fs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const { DatabaseSync } = require('node:sqlite');
const platformDb = require('../../db/platform');
const { createSchema } = require('../../db/schema');
const tenantContext = require('../../db/tenantContext');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');
const { logAction } = require('./_helpers');

const guard = [authenticatePlatform, authorizePlatform()];

function generateTempPassword() {
  return `Welcome@${crypto.randomInt(1000, 9999)}`;
}

function withLiveCounts(school) {
  try {
    return tenantContext.runWithTenant(school.id, () => {
      const db = require('../../db/database');
      const students = db.prepare('SELECT COUNT(*) as c FROM students WHERE is_active=1').get().c;
      const teachers = db.prepare('SELECT COUNT(*) as c FROM teachers WHERE is_active=1').get().c;
      return { ...school, students, teachers };
    });
  } catch {
    return { ...school, students: 0, teachers: 0 };
  }
}

// GET /api/platform/schools
router.get('/', ...guard, (req, res) => {
  const rows = platformDb.prepare(`
    SELECT s.*, p.name as plan_name, p.price as plan_price
    FROM schools s LEFT JOIN subscription_plans p ON p.id = s.plan_id
    ORDER BY s.created_at DESC
  `).all();
  res.json(rows.map(withLiveCounts));
});

// GET /api/platform/schools/:id
router.get('/:id', ...guard, (req, res) => {
  const school = platformDb.prepare(`
    SELECT s.*, p.name as plan_name, p.price as plan_price
    FROM schools s LEFT JOIN subscription_plans p ON p.id = s.plan_id
    WHERE s.id = ?
  `).get(req.params.id);
  if (!school) return res.status(404).json({ error: 'School not found' });
  res.json(withLiveCounts(school));
});

// GET /api/platform/schools/:id/summary — narrow read-only drill-in, never the full tenant CRUD surface
router.get('/:id/summary', ...guard, (req, res) => {
  const school = platformDb.prepare('SELECT id FROM schools WHERE id=?').get(req.params.id);
  if (!school) return res.status(404).json({ error: 'School not found' });

  const summary = tenantContext.runWithTenant(req.params.id, () => {
    const db = require('../../db/database');
    const students = db.prepare('SELECT COUNT(*) as c FROM students WHERE is_active=1').get().c;
    const teachers = db.prepare('SELECT COUNT(*) as c FROM teachers WHERE is_active=1').get().c;
    const classes = db.prepare('SELECT COUNT(*) as c FROM classes').get().c;
    const recentAnnouncements = db.prepare('SELECT title, created_at FROM announcements ORDER BY created_at DESC LIMIT 5').all();
    const fees = db.prepare('SELECT SUM(amount_paid) as collected, SUM(balance) as pending FROM fee_records').get();
    return { students, teachers, classes, recentAnnouncements, fees };
  });
  res.json(summary);
});

// POST /api/platform/schools — provisions a brand new isolated tenant
router.post('/', ...guard, (req, res) => {
  const { name, phone, address, plan_id, admin_name } = req.body;
  const email = req.body.email?.trim();
  const admin_email = req.body.admin_email?.trim();
  if (!name || !email || !plan_id || !admin_name || !admin_email) {
    return res.status(422).json({ error: 'name, email, plan_id, admin_name, admin_email are required' });
  }

  const directoryHit = platformDb.prepare('SELECT school_id FROM user_directory WHERE email=? COLLATE NOCASE').get(admin_email);
  if (directoryHit) return res.status(409).json({ error: 'Admin email already in use by another school' });

  const plan = platformDb.prepare('SELECT id FROM subscription_plans WHERE id=?').get(plan_id);
  if (!plan) return res.status(422).json({ error: 'Unknown plan_id' });

  const schoolId = uuid();
  const tempPassword = generateTempPassword();
  const dbPath = tenantContext.pathFor(schoolId);

  let tenantDb;
  try {
    tenantDb = new DatabaseSync(dbPath);
    tenantDb.exec('PRAGMA journal_mode = WAL');
    tenantDb.exec('PRAGMA foreign_keys = ON');
    createSchema(tenantDb);

    tenantDb.prepare(`
      INSERT INTO school (id, name, code, address, phone, email, head_teacher, motto, logo_url, updated_at)
      VALUES ('s1', ?, ?, ?, ?, ?, ?, NULL, NULL, datetime('now'))
    `).run(name, null, address || null, phone || null, email, admin_name);

    const adminUserId = uuid();
    const initials = admin_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3) || 'AD';
    tenantDb.prepare(`
      INSERT INTO users (id, name, email, password_hash, role, initials, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'super_admin', ?, 1, datetime('now'), datetime('now'))
    `).run(adminUserId, admin_name, admin_email, bcrypt.hashSync(tempPassword, 10), initials);

    tenantDb.close();
  } catch (e) {
    try { if (tenantDb) tenantDb.close(); } catch (_) {}
    try { if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath); } catch (_) {}
    return res.status(500).json({ error: 'Failed to provision school database', detail: e.message });
  }

  try {
    platformDb.transaction(() => {
      platformDb.prepare(`
        INSERT INTO schools (id, name, code, address, phone, email, admin_name, admin_email, plan_id, status, subscription_expiry, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?, 'active', NULL, datetime('now'), datetime('now'))
      `).run(schoolId, name, null, address || null, phone || null, email, admin_name, admin_email, plan_id);

      platformDb.prepare(`
        INSERT INTO user_directory (email, school_id, role, updated_at) VALUES (?,?,'super_admin', datetime('now'))
      `).run(admin_email, schoolId);
    })();
  } catch (e) {
    try { fs.unlinkSync(dbPath); } catch (_) {}
    return res.status(500).json({ error: 'Failed to register school', detail: e.message });
  }

  logAction(req, 'school.created', 'school', schoolId, { name });

  const school = platformDb.prepare('SELECT * FROM schools WHERE id=?').get(schoolId);
  res.status(201).json({ school, admin: { email: admin_email, tempPassword } });
});

// PUT /api/platform/schools/:id
router.put('/:id', ...guard, (req, res) => {
  const current = platformDb.prepare('SELECT * FROM schools WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'School not found' });

  const { name, address, phone, email, plan_id, subscription_expiry } = req.body;
  platformDb.prepare(`
    UPDATE schools SET name=?, address=?, phone=?, email=?, plan_id=?, subscription_expiry=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    name ?? current.name, address ?? current.address, phone ?? current.phone,
    email ?? current.email, plan_id ?? current.plan_id, subscription_expiry ?? current.subscription_expiry,
    req.params.id
  );

  logAction(req, 'school.updated', 'school', req.params.id, {});
  res.json(platformDb.prepare('SELECT * FROM schools WHERE id=?').get(req.params.id));
});

// PATCH /api/platform/schools/:id/activate
router.patch('/:id/activate', ...guard, (req, res) => {
  const school = platformDb.prepare('SELECT * FROM schools WHERE id=?').get(req.params.id);
  if (!school) return res.status(404).json({ error: 'School not found' });
  platformDb.prepare("UPDATE schools SET status='active', updated_at=datetime('now') WHERE id=?").run(req.params.id);
  logAction(req, 'school.activated', 'school', req.params.id, {});
  res.json(platformDb.prepare('SELECT * FROM schools WHERE id=?').get(req.params.id));
});

// PATCH /api/platform/schools/:id/deactivate
router.patch('/:id/deactivate', ...guard, (req, res) => {
  const school = platformDb.prepare('SELECT * FROM schools WHERE id=?').get(req.params.id);
  if (!school) return res.status(404).json({ error: 'School not found' });
  platformDb.prepare("UPDATE schools SET status='inactive', updated_at=datetime('now') WHERE id=?").run(req.params.id);
  logAction(req, 'school.deactivated', 'school', req.params.id, {});
  res.json(platformDb.prepare('SELECT * FROM schools WHERE id=?').get(req.params.id));
});

module.exports = router;
