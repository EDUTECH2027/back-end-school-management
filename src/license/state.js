/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// License status with an offline grace period.
//
//   valid  = true               → fully licensed, everything runs
//   valid  = false, inGrace=true → soft failure (expired, or offline too long);
//                                  the app keeps running and shows a warning
//   valid  = false, inGrace=false → hard stop (bad signature, revoked,
//                                   grace window elapsed)

const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const { getPublicKey } = require('./keys');
const { verifyLicense } = require('./verify');

const DAY = 86400000;

function loadLicenseFile() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(env.LICENSE_FILE), 'utf8'));
  } catch {
    return null;
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(env.LICENSE_STATE_FILE), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(patch) {
  const next = { ...readState(), ...patch };
  try {
    fs.writeFileSync(path.resolve(env.LICENSE_STATE_FILE), JSON.stringify(next, null, 2));
  } catch (e) {
    console.error('[license] could not persist state:', e.message);
  }
  return next;
}

function getStatus(opts = {}) {
  const now = opts.now || Date.now();
  const graceMs = env.LICENSE_GRACE_DAYS * DAY;
  const res = verifyLicense(loadLicenseFile(), getPublicKey(), { now });
  const st = readState();

  const base = { edition: res.license?.edition || null, expiresAt: res.license?.exp || null };
  const out = (valid, inGrace, reason) => ({ ...base, valid, inGrace, reason });

  // Deliberate kill: the license server told us this instance is revoked.
  if (st.revoked) return out(false, false, 'revoked');

  // Hard failures — signature/format/hardware. No grace.
  if (!res.valid && res.reason !== 'expired') return out(false, false, res.reason);

  // Signature is trusted from here on.
  let inGrace = false;
  let reason = 'ok';

  if (res.reason === 'expired') {
    const overdueMs = now - Date.parse(res.license.exp);
    if (overdueMs <= graceMs) { inGrace = true; reason = 'expired_grace'; }
    else return out(false, false, 'expired');
  }

  // If a license server is configured, require a recent successful check-in.
  if (env.LICENSE_SERVER_URL) {
    const anchor = st.lastOnlineOkAt ? Date.parse(st.lastOnlineOkAt)
      : (res.license?.iat ? Date.parse(res.license.iat) : now);
    const offlineMs = now - anchor;
    if (offlineMs > graceMs && offlineMs <= graceMs * 2) { inGrace = true; reason = 'offline_grace'; }
    else if (offlineMs > graceMs * 2) return out(false, false, 'offline');
  }

  return reason === 'ok' ? out(true, false, 'ok') : out(false, true, reason);
}

module.exports = { getStatus, readState, writeState, loadLicenseFile };
