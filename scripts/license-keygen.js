#!/usr/bin/env node
/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Generates the Ed25519 keypair used to sign / verify licenses.
// Run ONCE, offline. Keep license-keys/private.pem secret and out of git.
//
//   node scripts/license-keygen.js
//
// Then set LICENSE_PUBLIC_KEY (printed below) in every build's environment.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = path.join(__dirname, '..', 'license-keys');
fs.mkdirSync(dir, { recursive: true });

const privPath = path.join(dir, 'private.pem');
const pubPath = path.join(dir, 'public.pem');

if (fs.existsSync(privPath) && !process.argv.includes('--force')) {
  console.error(`Refusing to overwrite ${privPath} (pass --force to replace).`);
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));

const pubDerB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

console.log(`\nWrote:\n  ${privPath}  (KEEP SECRET)\n  ${pubPath}\n`);
console.log('Set this in the environment of every shipped build:\n');
console.log(`LICENSE_PUBLIC_KEY=${pubDerB64}\n`);
