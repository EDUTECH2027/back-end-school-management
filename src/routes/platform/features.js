const router = require('express').Router();
const { v4: uuid } = require('uuid');
const platformDb = require('../../db/platform');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');
const { logAction } = require('./_helpers');

const guard = [authenticatePlatform, authorizePlatform()];

// GET /api/platform/features
router.get('/', ...guard, (req, res) => {
  res.json(platformDb.prepare('SELECT * FROM features ORDER BY label').all());
});

// POST /api/platform/features
router.post('/', ...guard, (req, res) => {
  const { key, label, description } = req.body;
  if (!key || !label) return res.status(422).json({ error: 'key and label are required' });

  const existing = platformDb.prepare('SELECT id FROM features WHERE key=?').get(key);
  if (existing) return res.status(409).json({ error: 'Feature key already exists' });

  const id = uuid();
  platformDb.prepare('INSERT INTO features (id, key, label, description) VALUES (?,?,?,?)').run(id, key, label, description || null);
  logAction(req, 'feature.created', 'feature', id, { key });
  res.status(201).json(platformDb.prepare('SELECT * FROM features WHERE id=?').get(id));
});

// DELETE /api/platform/features/:id
router.delete('/:id', ...guard, (req, res) => {
  platformDb.prepare('DELETE FROM features WHERE id=?').run(req.params.id);
  logAction(req, 'feature.deleted', 'feature', req.params.id, {});
  res.status(204).end();
});

module.exports = router;
