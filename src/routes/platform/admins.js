const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const platformDb = require('../../db/platform');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');
const { logAction } = require('./_helpers');

const guard = [authenticatePlatform, authorizePlatform('platform_owner')];

// GET /api/platform/admins
router.get('/', ...guard, (req, res) => {
  const rows = platformDb.prepare('SELECT id, name, email, role, initials, created_at FROM platform_admins ORDER BY name').all();
  res.json(rows);
});

// POST /api/platform/admins
router.post('/', ...guard, (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(422).json({ error: 'name, email, password are required' });

  const existing = platformDb.prepare('SELECT id FROM platform_admins WHERE email=? COLLATE NOCASE').get(email);
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const id = uuid();
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3);
  platformDb.prepare(`
    INSERT INTO platform_admins (id, name, email, password_hash, role, initials, created_at, updated_at)
    VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))
  `).run(id, name, email, bcrypt.hashSync(password, 10), role === 'platform_owner' ? 'platform_owner' : 'platform_admin', initials);

  logAction(req, 'platform_admin.created', 'platform_admin', id, { email });
  res.status(201).json(platformDb.prepare('SELECT id, name, email, role, initials, created_at FROM platform_admins WHERE id=?').get(id));
});

// PUT /api/platform/admins/:id
router.put('/:id', ...guard, (req, res) => {
  const current = platformDb.prepare('SELECT * FROM platform_admins WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Admin not found' });

  const { name, role } = req.body;
  platformDb.prepare(`UPDATE platform_admins SET name=?, role=?, updated_at=datetime('now') WHERE id=?`)
    .run(name ?? current.name, role ?? current.role, req.params.id);

  logAction(req, 'platform_admin.updated', 'platform_admin', req.params.id, {});
  res.json(platformDb.prepare('SELECT id, name, email, role, initials, created_at FROM platform_admins WHERE id=?').get(req.params.id));
});

// DELETE /api/platform/admins/:id
router.delete('/:id', ...guard, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  platformDb.prepare('DELETE FROM platform_admins WHERE id=?').run(req.params.id);
  logAction(req, 'platform_admin.deleted', 'platform_admin', req.params.id, {});
  res.status(204).end();
});

module.exports = router;
