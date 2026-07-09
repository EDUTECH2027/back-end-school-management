// One-off ETL: reads the existing node:sqlite data (platform.db + per-tenant
// files) and writes it into the new Postgres schemas via a raw `pg` client.
// Read-only against SQLite; safe to re-run against a freshly wiped Postgres
// (does not touch/modify the source .db files in any way).
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { Client } = require('pg');
const { tenantUrlFor, platformUrl, schemaNameFor } = require('../src/db/tenantSchema');

// node-postgres (unlike Prisma's own connector) does not interpret a `?schema=`
// query param as search_path — it must be set explicitly per connection.
async function useSchema(pgClient, schemaName) {
  await pgClient.query(`SET search_path TO "${schemaName}"`);
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const PLATFORM_DB_PATH = path.join(DATA_DIR, 'platform.db');
const TENANTS_DIR = path.join(DATA_DIR, 'tenants');

const BOOLEAN_COLUMNS = new Set(['is_active', 'is_current', 'is_pinned', 'is_custom', 'must_change_password']);
const JSON_COLUMNS = new Set(['subjects', 'features', 'meta']);

function coerceRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) { out[k] = null; continue; }
    if (BOOLEAN_COLUMNS.has(k)) { out[k] = v === 1 || v === true; continue; }
    if (JSON_COLUMNS.has(k)) {
      // pg serializes JS arrays/objects as Postgres array literals, not JSON text,
      // so json/jsonb columns need the value passed as a JSON *string* and cast
      // explicitly in SQL (see insertRows) rather than as a parsed JS value.
      if (typeof v !== 'string') { out[k] = JSON.stringify(v); continue; }
      try { JSON.parse(v); out[k] = v; } catch { out[k] = JSON.stringify(v); }
      continue;
    }
    out[k] = v;
  }
  return out;
}

async function insertRows(pgClient, table, rows, { omitColumns = [] } = {}) {
  let count = 0;
  for (const raw of rows) {
    const row = coerceRow(raw);
    for (const col of omitColumns) delete row[col];
    const cols = Object.keys(row);
    if (cols.length === 0) continue;
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const values = cols.map(c => row[c]);
    const sql = `INSERT INTO ${table} (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`;
    try {
      await pgClient.query(sql, values);
      count++;
    } catch (e) {
      throw new Error(`Insert into ${table} failed for row id=${raw.id ?? '(no id)'}: ${e.message}`);
    }
  }
  return count;
}

function allRows(sqliteDb, table) {
  try {
    return sqliteDb.prepare(`SELECT * FROM ${table}`).all();
  } catch (e) {
    if (/no such table/i.test(e.message)) return [];
    throw e;
  }
}

const PLATFORM_TABLE_ORDER = [
  'subscription_plans',
  'features',
  'platform_settings',
  'platform_announcements',
  'schools',
  'platform_admins',
  'user_directory',
  'system_logs',
];

const TENANT_TABLE_ORDER_PASS1 = [
  'school',
  'academic_years',
  'terms',
  'grade_levels',
  'subjects',
];
// teachers/classes/students/parents/parent_students/users handled inline in
// migrateTenant() below, since their relative order matters (see comments there).
const TENANT_TABLE_ORDER_PASS3 = [
  'attendance_records',
  'teacher_attendance',
  'teacher_schedule',
  'marks',
  'report_cards',
  'report_card_entries',
  'fee_records',
  'payments',
  'teacher_payroll',
  'announcements',
  'email_alerts',
  'forum_threads',
  'forum_messages',
  'student_behavior',
  'salary_withdrawals',
];

async function migratePlatform() {
  console.log('\n=== Platform DB ===');
  if (!fs.existsSync(PLATFORM_DB_PATH)) {
    console.log('No platform.db found, skipping.');
    return { schools: [] };
  }
  const sqliteDb = new DatabaseSync(PLATFORM_DB_PATH, { readOnly: true });
  const pgClient = new Client({ connectionString: platformUrl() });
  await pgClient.connect();
  await useSchema(pgClient, 'platform');

  let schools = [];
  try {
    for (const table of PLATFORM_TABLE_ORDER) {
      const rows = allRows(sqliteDb, table);
      const n = await insertRows(pgClient, table, rows);
      console.log(`  ${table}: ${n} rows`);
      if (table === 'schools') schools = rows;
    }
  } finally {
    await pgClient.end();
    sqliteDb.close();
  }
  return { schools };
}

async function migrateTenant(schoolId, schoolName) {
  const dbPath = path.join(TENANTS_DIR, `${schoolId}.db`);
  if (!fs.existsSync(dbPath)) {
    console.warn(`  [WARN] No tenant file for ${schoolId} (${schoolName}) at ${dbPath} — skipping.`);
    return;
  }
  console.log(`\n=== Tenant ${schoolId} (${schoolName}) ===`);
  const sqliteDb = new DatabaseSync(dbPath, { readOnly: true });
  const pgClient = new Client({ connectionString: tenantUrlFor(schoolId) });
  await pgClient.connect();
  await useSchema(pgClient, schemaNameFor(schoolId));

  try {
    for (const table of TENANT_TABLE_ORDER_PASS1) {
      const n = await insertRows(pgClient, table, allRows(sqliteDb, table));
      console.log(`  ${table}: ${n} rows`);
    }

    // teachers/students/parents: omit user_id for now (circular FK with users).
    // Order matters beyond that: classes.class_teacher_id -> teachers, so teachers
    // must land before classes; students.class_id -> classes, so classes must land
    // before students; parent_students needs both parents and students.
    const teacherRows = allRows(sqliteDb, 'teachers');
    const studentRows = allRows(sqliteDb, 'students');
    const parentRows = allRows(sqliteDb, 'parents');
    console.log(`  teachers: ${await insertRows(pgClient, 'teachers', teacherRows, { omitColumns: ['user_id'] })} rows`);
    console.log(`  classes: ${await insertRows(pgClient, 'classes', allRows(sqliteDb, 'classes'))} rows`);
    console.log(`  students: ${await insertRows(pgClient, 'students', studentRows, { omitColumns: ['user_id'] })} rows`);
    console.log(`  parents: ${await insertRows(pgClient, 'parents', parentRows, { omitColumns: ['user_id'] })} rows`);
    console.log(`  parent_students: ${await insertRows(pgClient, 'parent_students', allRows(sqliteDb, 'parent_students'))} rows`);
    console.log(`  users: ${await insertRows(pgClient, 'users', allRows(sqliteDb, 'users'))} rows`);

    // Second pass: backfill teachers/students/parents.user_id now that users exist
    let backfilled = 0;
    for (const [table, rows] of [['teachers', teacherRows], ['students', studentRows], ['parents', parentRows]]) {
      for (const row of rows) {
        if (row.user_id) {
          await pgClient.query(`UPDATE ${table} SET user_id = $1 WHERE id = $2`, [row.user_id, row.id]);
          backfilled++;
        }
      }
    }
    console.log(`  (backfilled ${backfilled} user_id back-references)`);

    for (const table of TENANT_TABLE_ORDER_PASS3) {
      const n = await insertRows(pgClient, table, allRows(sqliteDb, table));
      console.log(`  ${table}: ${n} rows`);
    }
  } finally {
    await pgClient.end();
    sqliteDb.close();
  }
}

async function main() {
  // Integrity check: cross-reference platform.schools against files actually present.
  const filesPresent = fs.existsSync(TENANTS_DIR)
    ? fs.readdirSync(TENANTS_DIR).filter(f => f.endsWith('.db')).map(f => f.replace(/\.db$/, ''))
    : [];

  const { schools } = await migratePlatform();

  const registeredIds = new Set(schools.map(s => s.id));
  for (const fileId of filesPresent) {
    if (!registeredIds.has(fileId)) {
      console.warn(`[WARN] Tenant file ${fileId}.db has no matching row in platform.schools — will be skipped.`);
    }
  }

  for (const school of schools) {
    await migrateTenant(school.id, school.name);
  }

  console.log('\nMigration complete.');
}

main().catch(e => {
  console.error('\nMigration FAILED:', e.message);
  process.exit(1);
});
