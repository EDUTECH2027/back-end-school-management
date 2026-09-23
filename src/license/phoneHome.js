/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Periodic license check-in. Non-fatal on network failure — the offline grace
// window in state.js is what ultimately decides whether the app keeps running.

const crypto = require('crypto');
const os = require('os');
const env = require('../config/env');
const { loadLicenseFile, writeState } = require('./state');

function instanceId() {
  return crypto.createHash('sha256')
    .update(`${os.hostname()}|${process.env.DATABASE_URL || ''}`)
    .digest('hex')
    .slice(0, 32);
}

async function checkIn(counts = {}) {
  if (!env.LICENSE_SERVER_URL) return { skipped: true };
  const lic = loadLicenseFile();
  const licenseId = lic?.payload?.id;
  if (!licenseId) return { skipped: true };

  try {
    const resp = await fetch(`${env.LICENSE_SERVER_URL}/api/license/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_id: licenseId,
        instance_id: instanceId(),
        hostname: os.hostname(),
        schools: counts.schools ?? null,
        students: counts.students ?? null,
        version: require('../../package.json').version,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return { ok: false, status: resp.status };

    const data = await resp.json();
    writeState({
      lastOnlineOkAt: new Date().toISOString(),
      revoked: !!data.revoked,
      serverExpiresAt: data.expiresAt || null,
    });
    return { ok: true, revoked: !!data.revoked };
  } catch (e) {
    console.warn('[license] check-in failed (within grace):', e.message);
    return { ok: false, error: e.message };
  }
}

let timer = null;
function start(getCounts) {
  if (!env.LICENSE_SERVER_URL || timer) return;
  const run = async () => {
    const counts = typeof getCounts === 'function' ? await getCounts().catch(() => ({})) : {};
    await checkIn(counts);
  };
  run();
  timer = setInterval(run, env.LICENSE_PHONE_HOME_HOURS * 3600 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = { checkIn, start, instanceId };
