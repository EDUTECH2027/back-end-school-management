/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Account lockout after repeated failed logins.
//
// Works for both subject types: callers pass a Prisma model delegate
// (`platformClient.platformAdmin` or a tenant `db.user`) plus the freshly-read
// row. Counters live on the row itself, so a lock survives a process restart and
// a rotating-IP attack (unlike the IP rate limiter, which is the other layer).

const env = require('../config/env');

function lockRemainingMs(row) {
  if (!row || !row.locked_until) return 0;
  const remaining = new Date(row.locked_until).getTime() - Date.now();
  return remaining > 0 ? remaining : 0;
}

/** Throw a 429 (with a Retry-After hint) if the account is currently locked. */
function assertNotLocked(row) {
  const ms = lockRemainingMs(row);
  if (ms > 0) {
    const err = new Error('Too many failed attempts. This account is temporarily locked — try again later.');
    err.status = 429;
    err.retryAfterSeconds = Math.ceil(ms / 1000);
    throw err;
  }
}

async function registerFailure(model, row) {
  const now = Date.now();
  const windowMs = env.LOGIN_ATTEMPT_WINDOW_MINUTES * 60 * 1000;
  const lastFailed = row.last_failed_login_at ? new Date(row.last_failed_login_at).getTime() : 0;

  // The running count resets if the previous failure fell outside the window.
  const prior = now - lastFailed <= windowMs ? (row.failed_login_count || 0) : 0;
  const count = prior + 1;

  const data = { failed_login_count: count, last_failed_login_at: new Date(now) };

  if (count >= env.LOGIN_MAX_ATTEMPTS) {
    // Escalating lock: base minutes, doubling for each further full multiple of
    // the threshold, capped at 24h.
    const tier = Math.floor(count / env.LOGIN_MAX_ATTEMPTS);
    const minutes = Math.min(env.LOGIN_LOCK_MINUTES * 2 ** (tier - 1), 24 * 60);
    data.locked_until = new Date(now + minutes * 60 * 1000);
  }

  await model.update({ where: { id: row.id }, data });
}

async function registerSuccess(model, row) {
  if (!row.failed_login_count && !row.locked_until && !row.last_failed_login_at) return;
  await model.update({
    where: { id: row.id },
    data: { failed_login_count: 0, locked_until: null, last_failed_login_at: null },
  });
}

module.exports = { assertNotLocked, registerFailure, registerSuccess, lockRemainingMs };
