#!/usr/bin/env node
/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Stands in for a unit-test suite (no test runner in this repo).
//   npm run license:selftest
// Exercises verify.js against a throwaway keypair: happy path, tamper,
// expiry, wrong key, malformed.

const crypto = require('crypto');
const { verifyLicense, canonical } = require('../src/license/verify');

let failures = 0;
const check = (name, cond) => {
  const ok = !!cond;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
};

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const other = crypto.generateKeyPairSync('ed25519');

function sign(payload, key = privateKey) {
  return {
    payload,
    signature: crypto.sign(null, Buffer.from(canonical(payload), 'utf8'), key).toString('base64'),
  };
}

const now = Date.parse('2026-06-01T00:00:00Z');
const basePayload = {
  id: 'lic-1', school_name: 'Test School', edition: 'on_prem',
  seats: 100, iat: '2026-01-01T00:00:00Z', exp: '2027-01-01T00:00:00Z',
};

// 1. valid
check('valid license verifies', verifyLicense(sign(basePayload), publicKey, { now }).valid === true);

// 2. tampered payload
const tampered = sign(basePayload);
tampered.payload = { ...basePayload, seats: 999999 };
check('tampered payload rejected', verifyLicense(tampered, publicKey, { now }).reason === 'bad_signature');

// 3. expired
check('expired license rejected + flagged',
  (r => r.valid === false && r.reason === 'expired' && r.expired === true)
    (verifyLicense(sign(basePayload), publicKey, { now: Date.parse('2027-02-01T00:00:00Z') })));

// 4. not-yet-valid
check('nbf in the future rejected',
  verifyLicense(sign({ ...basePayload, nbf: '2026-09-01T00:00:00Z' }), publicKey, { now }).reason === 'not_yet_valid');

// 5. wrong key
check('signed with a different key rejected',
  verifyLicense(sign(basePayload, other.privateKey), publicKey, { now }).reason === 'bad_signature');

// 6. malformed
check('malformed object rejected', verifyLicense({ nope: true }, publicKey, { now }).reason === 'malformed');
check('null rejected', verifyLicense(null, publicKey, { now }).reason === 'malformed');

// 7. no public key
check('missing public key rejected', verifyLicense(sign(basePayload), null, { now }).reason === 'no_public_key');

// 8. perpetual (no exp)
check('perpetual license (no exp) verifies far in the future',
  verifyLicense(sign({ ...basePayload, exp: null }), publicKey, { now: Date.parse('2099-01-01T00:00:00Z') }).valid === true);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
