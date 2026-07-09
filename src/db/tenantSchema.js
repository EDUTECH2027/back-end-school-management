// Pure helpers for mapping a school id to its Postgres schema name / connection URL.
// Postgres identifiers: max 63 bytes, must not start with a digit, safest as [a-z0-9_].
// UUIDs are 36 chars with hyphens; stripping hyphens + a 'tenant_' prefix keeps this
// well under the limit and always identifier-safe without quoting.
function schemaNameFor(schoolId) {
  const clean = String(schoolId).toLowerCase().replace(/-/g, '').replace(/[^a-z0-9]/g, '');
  return `tenant_${clean}`;
}

function withSchema(baseUrl, schemaName) {
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}schema=${schemaName}`;
}

function tenantUrlFor(schoolId) {
  return withSchema(process.env.DATABASE_URL, schemaNameFor(schoolId));
}

function platformUrl() {
  return withSchema(process.env.DATABASE_URL, 'platform');
}

module.exports = { schemaNameFor, tenantUrlFor, platformUrl, withSchema };
