/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Verifies the SQLite -> Postgres migration: row-count parity per table, a
// field-by-field spot-check on sampled rows, and a byte-identity check on every
// password_hash (the single most important check — bcrypt hashes must survive
// the migration unchanged so existing users' passwords keep working).
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { Client, types } = require('pg');
const { tenantUrlFor, platformUrl, schemaNameFor } = require('../src/db/tenantSchema');

// node-postgres's default type parser turns timestamp/timestamptz columns into
// JS Date objects by reinterpreting the wall-clock value in the *local machine's*
// timezone — comparing those via toISOString() then introduces a spurious offset
// vs. SQLite's raw text. Disabling it here keeps both sides as plain strings,
// which is what actually got written (verified independently via ::text casts).
types.setTypeParser(1114, val => val); // timestamp without time zone
types.setTypeParser(1184, val => val); // timestamptz

const DATA_DIR = path.join(__dirname, '..', 'data');
const PLATFORM_DB_PATH = path.join(DATA_DIR, 'platform.db');
const TENANTS_DIR = path.join(DATA_DIR, 'tenants');
const SAMPLE_SIZE = 20;

const BOOLEAN_COLUMNS = new Set(['is_active', 'is_current', 'is_pinned', 'is_custom', 'must_change_password']);
const JSON_COLUMNS = new Set(['subjects', 'features', 'meta']);
const IGNORED_FOR_COMPARE = new Set(); // nothing volatile here — every timestamp is a straight passthrough

let failures = 0;

function normalize(k, v) {
  if (v === null || v === undefined) return null;
  if (BOOLEAN_COLUMNS.has(k)) return v === 1 || v === true;
  if (JSON_COLUMNS.has(k)) {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    try { return JSON.stringify(JSON.parse(s)); } catch { return s; }
  }
  // Postgres may return timestamp text with a ".000" fractional-second suffix
  // (Prisma's default DateTime precision) that SQLite's source text never had,
  // and always includes a time component (00:00:00) for date-only source values
  // (SQLite's `subscription_expiry` etc. store bare 'YYYY-MM-DD'). Neither is a
  // real data difference, so strip both before comparing.
  const s = String(v)
    .replace(/(\d{2}:\d{2}:\d{2})\.\d+$/, '$1')
    .replace(/ 00:00:00$/, '');
  return s;
}

async function useSchema(pgClient, schemaName) {
  await pgClient.query(`SET search_path TO "${schemaName}"`);
}

function allRows(sqliteDb, table) {
  try { return sqliteDb.prepare(`SELECT * FROM ${table}`).all(); }
  catch (e) { if (/no such table/i.test(e.message)) return []; throw e; }
}

async function verifyTable(sqliteDb, pgClient, table) {
  const sourceRows = allRows(sqliteDb, table);
  const { rows: destRows } = await pgClient.query(`SELECT * FROM "${table}"`);

  if (sourceRows.length !== destRows.length) {
    failures++;
    console.error(`  [FAIL] ${table}: row count mismatch — sqlite=${sourceRows.length} postgres=${destRows.length}`);
    return;
  }

  const destById = new Map(destRows.map(r => [r.id, r]));
  const sample = sourceRows
    .filter(r => r.id !== undefined)
    .sort(() => Math.random() - 0.5)
    .slice(0, SAMPLE_SIZE);

  let mismatches = 0;
  for (const srcRow of sample) {
    const destRow = destById.get(srcRow.id);
    if (!destRow) { mismatches++; console.error(`  [FAIL] ${table} id=${srcRow.id}: missing in Postgres`); continue; }
    for (const [k, srcVal] of Object.entries(srcRow)) {
      if (IGNORED_FOR_COMPARE.has(k)) continue;
      const a = normalize(k, srcVal);
      const b = normalize(k, destRow[k]);
      if (a !== b) {
        mismatches++;
        console.error(`  [FAIL] ${table} id=${srcRow.id} field=${k}: sqlite="${a}" postgres="${b}"`);
      }
    }
  }

  if (mismatches === 0) {
    console.log(`  [OK] ${table}: ${sourceRows.length} rows, ${sample.length} sampled, no diffs`);
  } else {
    failures += mismatches;
  }
}

async function verifyPasswordHashes(sqliteDb, pgClient, table) {
  const sourceRows = allRows(sqliteDb, table).filter(r => 'password_hash' in r);
  if (sourceRows.length === 0) return;
  const { rows: destRows } = await pgClient.query(`SELECT id, password_hash FROM "${table}"`);
  const destById = new Map(destRows.map(r => [r.id, r.password_hash]));
  let bad = 0;
  for (const row of sourceRows) {
    const destHash = destById.get(row.id);
    if (destHash !== row.password_hash) {
      bad++;
      console.error(`  [FAIL] ${table} id=${row.id}: password_hash mismatch`);
    }
  }
  if (bad === 0) console.log(`  [OK] ${table}: all ${sourceRows.length} password_hash values byte-identical`);
  else failures += bad;
}

const PLATFORM_TABLES = ['subscription_plans', 'features', 'platform_settings', 'platform_announcements', 'schools', 'platform_admins', 'user_directory', 'system_logs'];
const TENANT_TABLES = ['school', 'academic_years', 'terms', 'grade_levels', 'subjects', 'teachers', 'classes', 'students', 'parents', 'parent_students', 'users', 'attendance_records', 'teacher_attendance', 'teacher_schedule', 'marks', 'report_cards', 'report_card_entries', 'fee_records', 'payments', 'teacher_payroll', 'announcements', 'email_alerts', 'forum_threads', 'forum_messages', 'student_behavior', 'salary_withdrawals'];

async function main() {
  console.log('=== Platform DB ===');
  const platformSqlite = new DatabaseSync(PLATFORM_DB_PATH, { readOnly: true });
  const platformPg = new Client({ connectionString: platformUrl() });
  await platformPg.connect();
  await useSchema(platformPg, 'platform');
  for (const table of PLATFORM_TABLES) await verifyTable(platformSqlite, platformPg, table);
  await verifyPasswordHashes(platformSqlite, platformPg, 'platform_admins');
  const schools = allRows(platformSqlite, 'schools');
  await platformPg.end();
  platformSqlite.close();

  for (const school of schools) {
    const dbPath = path.join(TENANTS_DIR, `${school.id}.db`);
    if (!fs.existsSync(dbPath)) continue;
    console.log(`\n=== Tenant ${school.id} (${school.name}) ===`);
    const sqliteDb = new DatabaseSync(dbPath, { readOnly: true });
    const pgClient = new Client({ connectionString: tenantUrlFor(school.id) });
    await pgClient.connect();
    await useSchema(pgClient, schemaNameFor(school.id));
    for (const table of TENANT_TABLES) await verifyTable(sqliteDb, pgClient, table);
    await verifyPasswordHashes(sqliteDb, pgClient, 'users');
    await pgClient.end();
    sqliteDb.close();
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('Verification crashed:', e.message); process.exit(1); });
