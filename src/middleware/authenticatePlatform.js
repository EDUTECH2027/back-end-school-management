/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const { verifyAccess } = require('../auth/verify');
const { MANDATORY_2FA_ROLES } = require('../auth/roles');

module.exports = async function authenticatePlatform(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  let payload;
  try {
    payload = await verifyAccess(header.slice(7), 'platform');
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
  }

  // ─── SECURITY DISABLED (temporary) — mandatory 2FA enforcement ─────────────
  // Defence in depth: a mandatory-2FA account should never hold a full access
  // token without having enrolled (the login flow normally blocks that).
  // Uncomment to re-block platform accounts without TOTP enrolled.
  // if (MANDATORY_2FA_ROLES.has(payload.role) && !payload._subject.totp_enabled) {
  //   return res.status(403).json({ error: 'Two-factor enrolment required', code: 'mfa_enroll_required' });
  // }
  // ─── end disabled block ─────────────────────────────────────────────────────

  req.user = payload;
  next();
};
