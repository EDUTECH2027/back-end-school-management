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
  } catch (e) {
    console.error(`[provisionTenant] failed to drop schema for ${schoolId}:`, e.message);
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = { provisionTenantSchema, dropTenantSchema };
