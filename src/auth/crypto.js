/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Symmetric encryption for secrets we must be able to read back (TOTP seeds).
// AES-256-GCM with a random 96-bit IV per message; output is base64 of
// iv(12) || authTag(16) || ciphertext. Key comes from env.TOTP_ENC_KEY.

const crypto = require('crypto');
const env = require('../config/env');

const KEY = env.TOTP_ENC_KEY; // Buffer(32) | null

function assertKey() {
  if (!KEY) {
    const err = new Error('Two-factor is not available: TOTP_ENC_KEY is not configured on the server.');
    err.status = 503;
    throw err;
  }
}

function encrypt(plaintext) {
  assertKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

function decrypt(payloadB64) {
  assertKey();
  const buf = Buffer.from(String(payloadB64), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, isConfigured: () => !!KEY };
