/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Shared access-token verification: signature + expiry + the token_version
// kill-switch. Used by both the tenant and platform auth middleware.

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const platformClient = require('../db/platformClient');
const tenantPool = require('../db/tenantPool');

function fail(message, status, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

/**
 * @param {string} token            raw bearer token
 * @param {'platform'|'tenant'} [expectedScope]
 * @returns {Promise<object>} the JWT payload, with `_subject` attached
 *   ({ token_version, totp_enabled, role })
 */
async function verifyAccess(token, expectedScope) {
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (e) {
    if (e.name === 'TokenExpiredError') throw fail('Token expired', 401, 'token_expired');
    throw fail('Token invalid', 401, 'token_invalid');
  }

  if (expectedScope && payload.scope !== expectedScope) {
    throw fail('Forbidden', 403);
  }

  let subject;
  if (payload.scope === 'platform') {
    subject = await platformClient.platformAdmin.findUnique({
      where: { id: payload.id },
      select: { token_version: true, totp_enabled: true, role: true },
    });
  } else if (payload.scope === 'tenant') {
    const db = tenantPool.getOrOpen(payload.school_id);
    subject = await db.user.findUnique({
      where: { id: payload.id },
      select: { token_version: true, totp_enabled: true, role: true },
    });
  } else {
    throw fail('Token invalid', 401, 'token_invalid');
  }

  if (!subject) throw fail('Account not found', 401, 'subject_missing');
  if ((payload.tv || 0) !== (subject.token_version || 0)) {
    throw fail('Session is no longer valid. Please sign in again.', 401, 'token_version_stale');
  }

  payload._subject = subject;
  return payload;
}

module.exports = { verifyAccess };
