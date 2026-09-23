/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// GET /api/school
router.get('/', authenticate, async (req, res) => {
  const row = await req.db.school.findFirst();
  if (!row) return res.status(404).json({ error: 'School not found' });
  res.json(row);
});

// PUT /api/school
router.put('/', authenticate, async (req, res) => {
  const current = await req.db.school.findFirst();
  if (!current) return res.status(404).json({ error: 'School not found' });

  const { name, code, address, phone, email, head_teacher, motto, logo_url, require_admin_2fa } = req.body;

  // Only assign fields the caller actually sent, so a partial update (e.g. just
  // the 2FA toggle) doesn't blank out the rest.
  const data = { updated_at: new Date() };
  for (const [k, v] of Object.entries({ name, code, address, phone, email, head_teacher, motto })) {
    if (v !== undefined) data[k] = v;
  }
  if (logo_url !== undefined) data.logo_url = logo_url ?? null;

  // Only school admins may change the "require 2FA for admins" policy.
  if (require_admin_2fa !== undefined) {
    if (!['super_admin', 'head_teacher'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only an administrator can change this setting.' });
    }
    data.require_admin_2fa = !!require_admin_2fa;
  }

  await req.db.school.update({ where: { id: current.id }, data });
  res.json(await req.db.school.findFirst());
});

module.exports = router;
