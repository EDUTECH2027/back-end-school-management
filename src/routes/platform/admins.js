const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const platformClient = require('../../db/platformClient');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');
const { logAction } = require('./_helpers');

const guard = [authenticatePlatform, authorizePlatform('platform_owner')];

const PUBLIC_FIELDS = { id: true, name: true, email: true, role: true, initials: true, created_at: true };

// GET /api/platform/admins
router.get('/', ...guard, async (req, res) => {
  const rows = await platformClient.platformAdmin.findMany({ select: PUBLIC_FIELDS, orderBy: { name: 'asc' } });
  res.json(rows);
});

// POST /api/platform/admins
router.post('/', ...guard, async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(422).json({ error: 'name, email, password are required' });

  const existing = await platformClient.platformAdmin.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const id = uuid();
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3);
  const created = await platformClient.platformAdmin.create({
    data: {
      id, name, email, password_hash: bcrypt.hashSync(password, 10),
      role: role === 'platform_owner' ? 'platform_owner' : 'platform_admin', initials,
    },
    select: PUBLIC_FIELDS,
  });

  await logAction(req, 'platform_admin.created', 'platform_admin', id, { email });
  res.status(201).json(created);
});

// PUT /api/platform/admins/:id
router.put('/:id', ...guard, async (req, res) => {
  const current = await platformClient.platformAdmin.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: 'Admin not found' });

  const { name, role } = req.body;
  const updated = await platformClient.platformAdmin.update({
    where: { id: req.params.id },
    data: { name: name ?? current.name, role: role ?? current.role, updated_at: new Date() },
    select: PUBLIC_FIELDS,
  });

  await logAction(req, 'platform_admin.updated', 'platform_admin', req.params.id, {});
  res.json(updated);
});

// DELETE /api/platform/admins/:id
router.delete('/:id', ...guard, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  // deleteMany (not delete) to match SQLite's no-op-if-missing DELETE semantics
  // instead of Prisma's delete() throwing P2025 on a nonexistent id.
  await platformClient.platformAdmin.deleteMany({ where: { id: req.params.id } });
  await logAction(req, 'platform_admin.deleted', 'platform_admin', req.params.id, {});
  res.status(204).end();
});

module.exports = router;
