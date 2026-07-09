const router = require('express').Router();
const { v4: uuid } = require('uuid');
const platformClient = require('../../db/platformClient');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');
const { logAction } = require('./_helpers');

const guard = [authenticatePlatform, authorizePlatform()];

// GET /api/platform/features
router.get('/', ...guard, async (req, res) => {
  res.json(await platformClient.feature.findMany({ orderBy: { label: 'asc' } }));
});

// POST /api/platform/features
router.post('/', ...guard, async (req, res) => {
  const { key, label, description } = req.body;
  if (!key || !label) return res.status(422).json({ error: 'key and label are required' });

  const existing = await platformClient.feature.findUnique({ where: { key } });
  if (existing) return res.status(409).json({ error: 'Feature key already exists' });

  const id = uuid();
  const created = await platformClient.feature.create({ data: { id, key, label, description: description || null } });
  await logAction(req, 'feature.created', 'feature', id, { key });
  res.status(201).json(created);
});

// DELETE /api/platform/features/:id
router.delete('/:id', ...guard, async (req, res) => {
  await platformClient.feature.deleteMany({ where: { id: req.params.id } });
  await logAction(req, 'feature.deleted', 'feature', req.params.id, {});
  res.status(204).end();
});

module.exports = router;
