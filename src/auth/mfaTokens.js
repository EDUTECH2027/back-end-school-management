/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Short-lived, single-purpose tokens used between the two halves of the login
// flow (password step → 2FA step, or → forced enrolment). They are NOT access
// tokens: they only identify the subject and what they are allowed to do next.

const jwt = require('jsonwebtoken');
const env = require('../config/env');

function signPurposeToken(purpose, { subjectType, subjectId, schoolId }, ttl) {
  return jwt.sign(
    { purpose, st: subjectType, sid: subjectId, sch: schoolId || null },
    env.JWT_SECRET,
    { expiresIn: ttl },
  );
}

function verifyPurposeToken(token, purpose) {
  let p;
  try {
    p = jwt.verify(token, env.JWT_SECRET);
  } catch {
    const e = new Error('This step has expired. Please sign in again.');
    e.status = 401; e.code = 'step_expired';
    throw e;
  }
  if (p.purpose !== purpose) {
    const e = new Error('Invalid token for this step.');
    e.status = 401; e.code = 'step_invalid';
    throw e;
  }
  return { subjectType: p.st, subjectId: p.sid, schoolId: p.sch || null };
}

module.exports = { signPurposeToken, verifyPurposeToken };
