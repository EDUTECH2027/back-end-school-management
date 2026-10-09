/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Applies the tenant Prisma migrations to a school's Postgres schema, creating
// the schema on first connect if it doesn't exist yet (confirmed via spike:
// `prisma migrate deploy` auto-creates the schema named in its datasource URL).
// Used both for brand-new tenant provisioning and the boot-time "bring every
// registered school's schema up to date" pass that replaces the old per-tenant
// createSchema() loop in index.js.
const { execFile } = require('child_process');
const path = require('path');
const { Client } = require('pg');
const { tenantUrlFor, schemaNameFor, platformUrl } = require('./tenantSchema');
const tenantPool = require('./tenantPool');

const BACKEND_ROOT = path.join(__dirname, '..', '..');
const TENANT_SCHEMA_PATH = path.join('prisma', 'tenant', 'schema.prisma');
const PRISMA_CLI = require.resolve('prisma/build/index.js');

function provisionTenantSchema(schoolId) {
  return new Promise((resolve, reject) => {
    const url = tenantUrlFor(schoolId);
    execFile(
      process.execPath,
      [PRISMA_CLI, 'migrate', 'deploy', '--schema', TENANT_SCHEMA_PATH],
      { cwd: BACKEND_ROOT, env: { ...process.env, TENANT_TEMPLATE_DATABASE_URL: url } },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`Tenant schema migration failed for ${schoolId}: ${stderr || err.message}`));
        }
        resolve({ schema: schemaNameFor(schoolId), stdout });
      }
    );
  });
}

// Compensating cleanup for a failed provisioning attempt (mirrors the old
// fs.unlinkSync rollback-simulation, now dropping the Postgres schema instead
// of deleting a file). Best-effort: logs but does not throw on failure, since
// this always runs from inside an existing catch block.
async function dropTenantSchema(schoolId) {
  tenantPool.evict(schoolId);
  const client = new Client({ connectionString: platformUrl() });
  try {
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS "${schemaNameFor(schoolId)}" CASCADE`);
    return true;
  } catch (e) {
    console.error(`[provisionTenant] failed to drop schema for ${schoolId}:`, e.message);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

// ── Fast path for BRAND-NEW schools ─────────────────────────────────────────
// `prisma migrate deploy` starts the Prisma CLI and applies each migration in its own network round
// trips, ~30 s against a remote database. A new school has nothing to migrate, so instead we run
// every migration's SQL in ONE transaction / ONE round trip, then record each migration in
// "_prisma_migrations" exactly as Prisma does (same name + SHA-256 checksum). Later
// `migrate deploy` runs (the boot-time catch-up, backups) therefore see the schema as up to date.
// Anything unexpected falls back to the slow, proven CLI path, so creation can never get worse.
const fs = require('fs');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(BACKEND_ROOT, 'prisma', 'tenant', 'migrations');
let migrationCache = null;

function readMigrations() {
  if (migrationCache) return migrationCache;
  const names = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name).sort();
  migrationCache = names.map(name => {
    const buf = fs.readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'));
    return { name, sql: buf.toString('utf8'), checksum: crypto.createHash('sha256').update(buf).digest('hex') };
  });
  return migrationCache;
}

async function createTenantSchemaFast(schoolId) {
  const schema = schemaNameFor(schoolId); // "tenant_<hex>" — derived from a UUID, never user input
  const migrations = readMigrations();
  if (!migrations.length) throw new Error('no tenant migrations found');

  const script = [
    'BEGIN;',
    `CREATE SCHEMA "${schema}";`,
    `SET LOCAL search_path TO "${schema}";`,
    `CREATE TABLE "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    );`,
    ...migrations.flatMap(m => [
      m.sql,
      `INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","finished_at","applied_steps_count") VALUES ('${crypto.randomUUID()}','${m.checksum}','${m.name}',now(),1);`,
    ]),
    'COMMIT;',
  ].join('\n');

  const client = new Client({ connectionString: platformUrl() });
  try {
    await client.connect();
    await client.query(script); // simple-query protocol: the whole script is a single round trip
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end().catch(() => {});
  }
  return { schema, fast: true };
}

/** Creates + migrates the schema for a NEW school. Fast path first, CLI fallback. */
async function createTenantSchema(schoolId) {
  try {
    return await createTenantSchemaFast(schoolId);
  } catch (e) {
    console.warn(`[provisionTenant] fast path failed for ${schoolId} (${String(e.message).slice(0, 200)}); falling back to prisma migrate deploy`);
    await dropTenantSchema(schoolId); // clear any partial state, then do it the slow, proven way
    return provisionTenantSchema(schoolId);
  }
}

module.exports = { provisionTenantSchema, createTenantSchema, dropTenantSchema };
