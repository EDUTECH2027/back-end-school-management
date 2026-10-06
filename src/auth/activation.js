/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Stateless, single-use account-activation links (no DB table needed).
//
// The token is a signed JWT bound to a fingerprint of the user's CURRENT
// password hash. Once the user sets a password the hash changes, so the same
// link can never be used again; it also expires on its own.

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');

const PURPOSE = 'activate_account';
const TTL = process.env.ACTIVATION_TOKEN_TTL || '7d';

const fingerprint = (passwordHash) =>
  crypto.createHash('sha256').update(String(passwordHash)).digest('hex').slice(0, 24);

function signActivationToken({ schoolId, userId, passwordHash }) {
  return jwt.sign({ purpose: PURPOSE, sch: schoolId, uid: userId, fp: fingerprint(passwordHash) }, env.JWT_SECRET, { expiresIn: TTL });
}

// Returns { schoolId, userId, fp } or throws an Error with .status = 400.
function verifyActivationToken(token) {
  let p;
  try { p = jwt.verify(token, env.JWT_SECRET); } catch {
    const e = new Error('This activation link is invalid or has expired. Ask your administrator to resend it.');
    e.status = 400; throw e;
  }
  if (p.purpose !== PURPOSE) {
    const e = new Error('This activation link is invalid.'); e.status = 400; throw e;
  }
  return { schoolId: p.sch, userId: p.uid, fp: p.fp };
}

module.exports = { signActivationToken, verifyActivationToken, fingerprint };
