/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const platformClient = require('../../db/platformClient');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');
const { logAction } = require('./_helpers');

const guard = [authenticatePlatform, authorizePlatform()];

// GET /api/platform/plans
router.get('/', ...guard, async (req, res) => {
  const plans = await platformClient.subscriptionPlan.findMany({
    include: { _count: { select: { schools: true } } },
    orderBy: { price: 'asc' },
  });
  res.json(plans.map(p => ({ ...p, school_count: p._count.schools, _count: undefined })));
});

// POST /api/platform/plans
router.post('/', ...guard, async (req, res) => {
  const { name, price, billing_cycle, max_students, max_teachers, features, is_custom } = req.body;
  if (!name || price == null) return res.status(422).json({ error: 'name and price are required' });

  const id = uuid();
  const created = await platformClient.subscriptionPlan.create({
    data: {
      id, name, price, billing_cycle: billing_cycle || 'monthly',
      max_students: max_students ?? null, max_teachers: max_teachers ?? null,
      features: features || [], is_custom: !!is_custom,
    },
  });

  await logAction(req, 'plan.created', 'subscription_plan', id, { name });
  res.status(201).json(created);
});

// PUT /api/platform/plans/:id
router.put('/:id', ...guard, async (req, res) => {
  const current = await platformClient.subscriptionPlan.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: 'Plan not found' });

  const { name, price, billing_cycle, max_students, max_teachers, features, is_custom } = req.body;
  const updated = await platformClient.subscriptionPlan.update({
    where: { id: req.params.id },
    data: {
      name: name ?? current.name,
      price: price ?? current.price,
      billing_cycle: billing_cycle ?? current.billing_cycle,
      max_students: max_students !== undefined ? max_students : current.max_students,
      max_teachers: max_teachers !== undefined ? max_teachers : current.max_teachers,
      features: features ?? current.features,
      is_custom: is_custom !== undefined ? !!is_custom : current.is_custom,
      updated_at: new Date(),
    },
  });

  await logAction(req, 'plan.updated', 'subscription_plan', req.params.id, {});
  res.json(updated);
});

// DELETE /api/platform/plans/:id
router.delete('/:id', ...guard, async (req, res) => {
  const inUse = await platformClient.school.count({ where: { plan_id: req.params.id } });
  if (inUse > 0) return res.status(409).json({ error: 'Plan is assigned to one or more schools' });
  await platformClient.subscriptionPlan.deleteMany({ where: { id: req.params.id } });
  await logAction(req, 'plan.deleted', 'subscription_plan', req.params.id, {});
  res.status(204).end();
});

module.exports = router;
