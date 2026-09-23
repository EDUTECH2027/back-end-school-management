/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// The Ed25519 public key that verifies license files. Baked into the build via
// LICENSE_PUBLIC_KEY (base64-encoded SPKI DER). The matching private key lives
// only on the vendor's signing machine and is never shipped.

const crypto = require('crypto');
const env = require('../config/env');

let cached;

function getPublicKey() {
  if (cached !== undefined) return cached;
  cached = null;
  if (env.LICENSE_PUBLIC_KEY) {
    try {
      cached = crypto.createPublicKey({
        key: Buffer.from(env.LICENSE_PUBLIC_KEY, 'base64'),
        format: 'der',
        type: 'spki',
      });
    } catch (e) {
      console.error('[license] LICENSE_PUBLIC_KEY is not a valid base64 SPKI key:', e.message);
      cached = null;
    }
  }
  return cached;
}

module.exports = { getPublicKey };
