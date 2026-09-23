/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Public license status — drives an in-app banner on on-prem builds.
// Always responds 200 (even when unlicensed) so the client can render the reason.

const router = require('express').Router();
const env = require('../config/env');
const platformClient = require('../db/platformClient');
const { getStatus } = require('../license/state');

router.get('/status', (_req, res) => {
  if (!env.LICENSE_REQUIRED) {
    return res.json({ required: false, valid: true, inGrace: false, edition: 'saas' });
  }
  const s = getStatus();
  res.json({
    required: true,
    valid: s.valid,
    inGrace: s.inGrace,
    reason: s.reason,
    edition: s.edition,
    expiresAt: s.expiresAt,
  });
});

// ── Check-in endpoint that on-prem instances phone home to ──────────────────
// (Served by whichever deployment acts as the license server — typically the
//  vendor's own SaaS instance.)
router.post('/check', async (req, res) => {
  const { license_id, instance_id } = req.body || {};
  if (!license_id) return res.status(422).json({ error: 'license_id required' });

  const row = await platformClient.issuedLicense.findUnique({ where: { id: license_id } }).catch(() => null);
  if (!row) return res.json({ valid: false, revoked: true, reason: 'unknown_license' });

  await platformClient.issuedLicense.update({
    where: { id: license_id },
    data: {
      last_seen_at: new Date(),
      last_seen_ip: req.ip || null,
      instance_id: instance_id || row.instance_id,
    },
  }).catch(() => {});

  const expired = row.expires_at && row.expires_at.getTime() < Date.now();
  res.json({
    valid: !row.revoked_at && !expired,
    revoked: !!row.revoked_at,
    expiresAt: row.expires_at || null,
  });
});

module.exports = router;
