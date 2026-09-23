/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Platform-owner tools for issuing / revoking on-prem licenses.

const router = require('express').Router();
const { v4: uuid } = require('uuid');
const platformClient = require('../../db/platformClient');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');
const { logAction } = require('./_helpers');

const guard = [authenticatePlatform, authorizePlatform('platform_owner')];

router.get('/', ...guard, async (_req, res) => {
  const rows = await platformClient.issuedLicense.findMany({ orderBy: { issued_at: 'desc' } });
  res.json(rows);
});

// POST /api/platform/licenses  → creates the record AND returns the signed file.
router.post('/', ...guard, async (req, res) => {
  const { school_name, edition, seats, max_students, expires_at, hardware_id, notes } = req.body;
  if (!school_name) return res.status(422).json({ error: 'school_name is required' });

  let signPayload;
  try { ({ signPayload } = require('../../license/sign')); } catch { /* handled below */ }

  const id = uuid();
  const payload = {
    id,
    school_name,
    edition: edition || 'on_prem',
    seats: seats ?? null,
    max_students: max_students ?? null,
    hardware_id: hardware_id || null,
    iat: new Date().toISOString(),
    exp: expires_at ? new Date(expires_at).toISOString() : null,
  };

  let file;
  try {
    file = signPayload(payload);
  } catch (e) {
    return res.status(501).json({
      error: 'Signing key not available on this server. Set LICENSE_SIGNING_KEY or run scripts/license-sign.js offline.',
      detail: e.message,
    });
  }

  const row = await platformClient.issuedLicense.create({
    data: {
      id, school_name, edition: payload.edition,
      seats: payload.seats, max_students: payload.max_students,
      hardware_id: payload.hardware_id, expires_at: payload.exp ? new Date(payload.exp) : null,
      notes: notes || null,
    },
  });

  await logAction(req, 'license.issued', 'issued_license', id, { school_name });
  res.status(201).json({ license: row, file });
});

router.patch('/:id/revoke', ...guard, async (req, res) => {
  const row = await platformClient.issuedLicense.update({
    where: { id: req.params.id }, data: { revoked_at: new Date() },
  }).catch(() => null);
  if (!row) return res.status(404).json({ error: 'License not found' });
  await logAction(req, 'license.revoked', 'issued_license', req.params.id, {});
  res.json(row);
});

router.patch('/:id/unrevoke', ...guard, async (req, res) => {
  const row = await platformClient.issuedLicense.update({
    where: { id: req.params.id }, data: { revoked_at: null },
  }).catch(() => null);
  if (!row) return res.status(404).json({ error: 'License not found' });
  await logAction(req, 'license.unrevoked', 'issued_license', req.params.id, {});
  res.json(row);
});

router.delete('/:id', ...guard, async (req, res) => {
  await platformClient.issuedLicense.deleteMany({ where: { id: req.params.id } });
  await logAction(req, 'license.deleted', 'issued_license', req.params.id, {});
  res.status(204).end();
});

module.exports = router;
