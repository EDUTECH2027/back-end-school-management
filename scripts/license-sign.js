#!/usr/bin/env node
/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Signs a license file. Vendor side only — needs license-keys/private.pem.
//
//   node scripts/license-sign.js \
//     --school "Green Valley Academy" \
//     --edition on_prem \
//     --seats 500 \
//     --students 4000 \
//     --expires 2027-09-01 \
//     [--hardware <fingerprint>] \
//     --out green-valley.lic

const fs = require('fs');
const { v4: uuid } = require('uuid');
const { signPayload } = require('../src/license/sign');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}

const school = arg('school');
if (!school) {
  console.error('Missing --school. See the header of this file for usage.');
  process.exit(1);
}

const expires = arg('expires');
const payload = {
  id: arg('id', uuid()),
  school_name: school,
  edition: arg('edition', 'on_prem'),
  seats: arg('seats') ? Number(arg('seats')) : null,
  max_students: arg('students') ? Number(arg('students')) : null,
  hardware_id: arg('hardware', null),
  iat: new Date().toISOString(),
  exp: expires ? new Date(expires).toISOString() : null,
};

let file;
try {
  file = signPayload(payload);
} catch (e) {
  console.error('Signing failed:', e.message);
  console.error('Run scripts/license-keygen.js first, or set LICENSE_SIGNING_KEY.');
  process.exit(1);
}

const out = arg('out', `${school.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.lic`);
fs.writeFileSync(out, JSON.stringify(file, null, 2));
console.log(`Wrote ${out}`);
console.log(JSON.stringify(payload, null, 2));
