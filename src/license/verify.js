/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Pure license verification — no filesystem, no env, fully unit-testable.
//
// A license file is JSON: { payload: {...}, signature: "<base64>" }
// The signature is Ed25519 over the canonical (sorted-key) JSON of `payload`.
//
// payload fields:
//   id           unique license id
//   school_name  display only
//   edition      e.g. "on_prem"
//   seats        max teacher/admin seats (optional)
//   max_students optional
//   iat          issued-at ISO date
//   nbf          not-before ISO date (optional)
//   exp          expiry ISO date (optional; absent = perpetual)
//   hardware_id  optional machine binding (see machineFingerprint)

const crypto = require('crypto');
const os = require('os');

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map(k => JSON.stringify(k) + ':' + canonical(value[k]))
      .join(',') + '}';
  }
  return JSON.stringify(value);
}

function machineFingerprint() {
  const nets = os.networkInterfaces();
  let mac = '';
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (!ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00') { mac = ni.mac; break; }
    }
    if (mac) break;
  }
  return crypto.createHash('sha256').update(`${os.hostname()}|${mac}`).digest('hex');
}

/**
 * @returns {{ valid:boolean, reason:string, license?:object, expired?:boolean }}
 */
function verifyLicense(licenseObj, publicKey, opts = {}) {
  const now = opts.now || Date.now();
  if (!publicKey) return { valid: false, reason: 'no_public_key' };
  if (!licenseObj || typeof licenseObj !== 'object' || !licenseObj.payload || !licenseObj.signature) {
    return { valid: false, reason: 'malformed' };
  }

  let sigOk = false;
  try {
    sigOk = crypto.verify(
      null,
      Buffer.from(canonical(licenseObj.payload), 'utf8'),
      publicKey,
      Buffer.from(licenseObj.signature, 'base64'),
    );
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { valid: false, reason: 'bad_signature' };

  const p = licenseObj.payload;
  if (p.nbf && now < Date.parse(p.nbf)) return { valid: false, reason: 'not_yet_valid', license: p };
  if (p.exp && now > Date.parse(p.exp)) return { valid: false, reason: 'expired', expired: true, license: p };
  if (p.hardware_id && p.hardware_id !== machineFingerprint()) {
    return { valid: false, reason: 'hardware_mismatch', license: p };
  }
  return { valid: true, reason: 'ok', license: p };
}

module.exports = { verifyLicense, canonical, machineFingerprint };
