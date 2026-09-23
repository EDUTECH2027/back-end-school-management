/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// License signing — vendor side only. Needs the Ed25519 private key, which is
// never part of a normal deployment. Path comes from LICENSE_SIGNING_KEY or
// defaults to backend/license-keys/private.pem (gitignored).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { canonical } = require('./verify');

function privateKeyPath() {
  return process.env.LICENSE_SIGNING_KEY
    || path.join(__dirname, '..', '..', 'license-keys', 'private.pem');
}

function loadPrivateKey() {
  return crypto.createPrivateKey(fs.readFileSync(privateKeyPath(), 'utf8'));
}

function signPayload(payload, privateKey) {
  const key = privateKey || loadPrivateKey();
  const signature = crypto.sign(null, Buffer.from(canonical(payload), 'utf8'), key).toString('base64');
  return { payload, signature };
}

module.exports = { signPayload, loadPrivateKey, privateKeyPath };
