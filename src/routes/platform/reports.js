/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const platformClient = require('../../db/platformClient');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');

const guard = [authenticatePlatform, authorizePlatform()];

// GET /api/platform/reports/schools-by-status
router.get('/schools-by-status', ...guard, async (req, res) => {
  const rows = await platformClient.school.groupBy({ by: ['status'], _count: { _all: true } });
  res.json(rows.map(r => ({ status: r.status, count: r._count._all })));
});

// GET /api/platform/reports/revenue-by-plan
router.get('/revenue-by-plan', ...guard, async (req, res) => {
  const plans = await platformClient.subscriptionPlan.findMany({
    include: { schools: { where: { status: 'active' }, select: { id: true } } },
  });
  const rows = plans
    .map(p => ({ plan_name: p.name, price: p.price, school_count: p.schools.length, revenue: p.price * p.schools.length }))
    .sort((a, b) => b.revenue - a.revenue);
  res.json(rows);
});

// GET /api/platform/reports/signups-by-month
router.get('/signups-by-month', ...guard, async (req, res) => {
  const schools = await platformClient.school.findMany({ select: { created_at: true } });
  const byMonth = new Map();
  for (const s of schools) {
    const month = (s.created_at instanceof Date ? s.created_at.toISOString() : String(s.created_at || '')).slice(0, 7);
    byMonth.set(month, (byMonth.get(month) || 0) + 1);
  }
  res.json([...byMonth.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)));
});

module.exports = router;
