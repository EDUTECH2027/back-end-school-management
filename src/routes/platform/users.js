/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const platformClient = require('../../db/platformClient');
const tenantPool = require('../../db/tenantPool');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');

const guard = [authenticatePlatform, authorizePlatform()];

// GET /api/platform/users — read-only aggregate across every tenant schema
router.get('/', ...guard, async (req, res) => {
  const schools = await platformClient.school.findMany({ select: { id: true, name: true } });
  const all = [];

  for (const school of schools) {
    try {
      const tenantDb = tenantPool.getOrOpen(school.id);
      const rows = await tenantDb.user.findMany({
        select: { id: true, name: true, email: true, role: true, initials: true, created_at: true },
        orderBy: { name: 'asc' },
      });
      for (const r of rows) all.push({ ...r, school_id: school.id, school_name: school.name });
    } catch (_) {
      // tenant schema unreadable/missing — skip rather than fail the whole aggregate
    }
  }

  res.json(all);
});

module.exports = router;
