const router = require('express').Router();
const { v4: uuid } = require('uuid');
const platformDb = require('../../db/platform');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');
const { logAction } = require('./_helpers');

const guard = [authenticatePlatform, authorizePlatform()];

// GET /api/platform/plans
router.get('/', ...guard, (req, res) => {
  const plans = platformDb.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM schools s WHERE s.plan_id = p.id) as school_count
    FROM subscription_plans p ORDER BY p.price ASC
  `).all();
  res.json(plans);
});

// POST /api/platform/plans
router.post('/', ...guard, (req, res) => {
  const { name, price, billing_cycle, max_students, max_teachers, features, is_custom } = req.body;
  if (!name || price == null) return res.status(422).json({ error: 'name and price are required' });

  const id = uuid();
  platformDb.prepare(`
    INSERT INTO subscription_plans (id, name, price, billing_cycle, max_students, max_teachers, features, is_custom, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
  `).run(id, name, price, billing_cycle || 'monthly', max_students ?? null, max_teachers ?? null, JSON.stringify(features || []), is_custom ? 1 : 0);

  logAction(req, 'plan.created', 'subscription_plan', id, { name });
  res.status(201).json(platformDb.prepare('SELECT * FROM subscription_plans WHERE id=?').get(id));
});

// PUT /api/platform/plans/:id
router.put('/:id', ...guard, (req, res) => {
  const current = platformDb.prepare('SELECT * FROM subscription_plans WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Plan not found' });

  const { name, price, billing_cycle, max_students, max_teachers, features, is_custom } = req.body;
  platformDb.prepare(`
    UPDATE subscription_plans SET name=?, price=?, billing_cycle=?, max_students=?, max_teachers=?, features=?, is_custom=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    name ?? current.name, price ?? current.price, billing_cycle ?? current.billing_cycle,
    max_students !== undefined ? max_students : current.max_students,
    max_teachers !== undefined ? max_teachers : current.max_teachers,
    features ? JSON.stringify(features) : current.features,
    is_custom !== undefined ? (is_custom ? 1 : 0) : current.is_custom,
    req.params.id
  );

  logAction(req, 'plan.updated', 'subscription_plan', req.params.id, {});
  res.json(platformDb.prepare('SELECT * FROM subscription_plans WHERE id=?').get(req.params.id));
});

// DELETE /api/platform/plans/:id
router.delete('/:id', ...guard, (req, res) => {
  const inUse = platformDb.prepare('SELECT COUNT(*) as c FROM schools WHERE plan_id=?').get(req.params.id).c;
  if (inUse > 0) return res.status(409).json({ error: 'Plan is assigned to one or more schools' });
  platformDb.prepare('DELETE FROM subscription_plans WHERE id=?').run(req.params.id);
  logAction(req, 'plan.deleted', 'subscription_plan', req.params.id, {});
  res.status(204).end();
});

module.exports = router;
