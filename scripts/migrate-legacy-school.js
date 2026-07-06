/**
 * One-off migration: registers the pre-existing single-tenant
 * backend/data/school.db as the first tenant ("School #1") in the new
 * multi-tenant platform registry.
 *
 * Idempotent: no-ops if backend/data/tenants/ already contains files or the
 * platform registry already has schools. Run with the server stopped:
 *   node scripts/migrate-legacy-school.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const { DatabaseSync } = require('node:sqlite');

const platformDb = require('../src/db/platform');
const { createPlatformSchema } = require('../src/db/platformSchema');
const { createSchema } = require('../src/db/schema');
const tenantContext = require('../src/db/tenantContext');

createPlatformSchema(platformDb);

const legacyDbPath = path.resolve(process.env.DB_PATH || './data/school.db');

function main() {
  const existingSchools = platformDb.prepare('SELECT COUNT(*) as n FROM schools').get().n;
  if (existingSchools > 0) {
    console.log('[migrate] Platform registry already has schools — skipping (already migrated).');
    return;
  }
  if (fs.existsSync(tenantContext.TENANTS_DIR) && fs.readdirSync(tenantContext.TENANTS_DIR).length > 0) {
    console.log('[migrate] backend/data/tenants/ already has files — skipping (already migrated).');
    return;
  }
  if (!fs.existsSync(legacyDbPath)) {
    console.log(`[migrate] No legacy database found at ${legacyDbPath} — nothing to migrate.`);
    return;
  }

  const schoolId = uuid();
  console.log(`[migrate] Migrating ${legacyDbPath} -> tenant ${schoolId}`);

  // Safety copy before touching the original file.
  fs.copyFileSync(legacyDbPath, `${legacyDbPath}.pre-migration-backup`);
  for (const ext of ['-wal', '-shm']) {
    const sidecar = legacyDbPath + ext;
    if (fs.existsSync(sidecar)) fs.copyFileSync(sidecar, `${sidecar}.pre-migration-backup`);
  }

  const newPath = tenantContext.pathFor(schoolId);
  fs.mkdirSync(path.dirname(newPath), { recursive: true });
  fs.renameSync(legacyDbPath, newPath);
  for (const ext of ['-wal', '-shm']) {
    const sidecar = legacyDbPath + ext;
    if (fs.existsSync(sidecar)) fs.renameSync(sidecar, newPath + ext);
  }

  const tenantDb = new DatabaseSync(newPath);
  tenantDb.exec('PRAGMA journal_mode = WAL');
  tenantDb.exec('PRAGMA foreign_keys = ON');
  createSchema(tenantDb); // pick up any pending inline migrations

  const schoolRow = tenantDb.prepare('SELECT * FROM school LIMIT 1').get();
  const users = tenantDb.prepare('SELECT * FROM users').all();
  const adminUser = users.find(u => u.role === 'super_admin' || u.role === 'head_teacher') || users[0];
  tenantDb.close();

  if (!schoolRow) {
    console.warn('[migrate] Legacy database has no `school` row — using placeholder values.');
  }

  platformDb.transaction(() => {
    platformDb.prepare(`
      INSERT INTO schools (id, name, code, address, phone, email, admin_name, admin_email, plan_id, status, subscription_expiry, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?, 'plan-premium', 'active', NULL, datetime('now'), datetime('now'))
    `).run(
      schoolId,
      schoolRow?.name || 'School #1',
      schoolRow?.code || null,
      schoolRow?.address || null,
      schoolRow?.phone || null,
      schoolRow?.email || (adminUser ? adminUser.email : 'admin@school.local'),
      adminUser ? adminUser.name : 'Administrator',
      adminUser ? adminUser.email : 'admin@school.local'
    );

    for (const u of users) {
      platformDb.prepare(`
        INSERT OR REPLACE INTO user_directory (email, school_id, role, updated_at) VALUES (?,?,?,datetime('now'))
      `).run(u.email, schoolId, u.role);
    }
  })();

  console.log(`[migrate] Done. School #1 registered as ${schoolId}.`);
  console.log(`[migrate] Existing logins (${users.map(u => u.email).join(', ')}) continue to work unchanged.`);
  console.log(`[migrate] Backup of the original file kept at ${legacyDbPath}.pre-migration-backup`);
}

main();
