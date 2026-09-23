#!/usr/bin/env node
// Prepends the proprietary copyright header to source files. Idempotent — run it
// as often as you like; files that already carry the marker are skipped.
//
//   node scripts/add-license-headers.js            # apply
//   node scripts/add-license-headers.js --check    # exit 1 if any file is missing it (CI)

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const MARKER = 'All rights reserved.';
const HEADER = [
  '/*',
  ' * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.',
  ' * Proprietary and confidential. Unauthorized copying, distribution or',
  ' * modification of this file, via any medium, is strictly prohibited.',
  ' */',
  '',
].join('\n');

const ROOTS = [
  { dir: path.join(REPO_ROOT, 'backend', 'src'), exts: ['.js'] },
  { dir: path.join(REPO_ROOT, 'backend', 'scripts'), exts: ['.js'] },
  { dir: path.join(REPO_ROOT, 'EDUTECH', 'src'), exts: ['.ts', '.tsx'] },
];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'migrations', '.prisma', 'assets']);

function walk(dir, exts, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), exts, out);
    } else if (exts.includes(path.extname(e.name))) {
      out.push(path.join(dir, e.name));
    }
  }
}

const checkOnly = process.argv.includes('--check');
const files = [];
for (const { dir, exts } of ROOTS) walk(dir, exts, files);

let changed = 0;
let missing = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes(MARKER)) continue;

  missing++;
  if (checkOnly) {
    console.log('MISSING  ' + path.relative(REPO_ROOT, file));
    continue;
  }

  let next;
  if (src.startsWith('#!')) {
    const nl = src.indexOf('\n');
    next = src.slice(0, nl + 1) + HEADER + src.slice(nl + 1);
  } else {
    next = HEADER + src;
  }
  fs.writeFileSync(file, next);
  changed++;
  console.log('ADDED    ' + path.relative(REPO_ROOT, file));
}

if (checkOnly) {
  console.log(missing ? `\n${missing} file(s) missing the header` : '\nAll files carry the header');
  process.exit(missing ? 1 : 0);
}
console.log(`\n${changed} file(s) updated, ${files.length - changed} already had it.`);
