/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// LRU pool of PrismaClient instances, one per tenant schema — replaces the
// connection-pool half of tenantContext.js. No AsyncLocalStorage: callers resolve
// a client explicitly (middleware/auth.js sets req.db) rather than relying on
// implicit per-request context, since nothing here runs outside a request.
const { PrismaClient } = require('../../node_modules/.prisma/tenant-client');
const { tenantUrlFor } = require('./tenantSchema');

const MAX_OPEN = Number(process.env.MAX_OPEN_TENANT_PRISMA_CLIENTS) || 25;

/** @type {Map<string, { client: PrismaClient, lastUsed: number }>} */
const pool = new Map();

function evictLruIfOverCap() {
  if (pool.size <= MAX_OPEN) return;
  let oldestId = null;
  let oldestTime = Infinity;
  for (const [id, entry] of pool) {
    if (entry.lastUsed < oldestTime) {
      oldestTime = entry.lastUsed;
      oldestId = id;
    }
  }
  if (oldestId) evict(oldestId);
}

function getOrOpen(schoolId) {
  let entry = pool.get(schoolId);
  if (!entry) {
    const client = new PrismaClient({ datasourceUrl: tenantUrlFor(schoolId) });
    entry = { client, lastUsed: Date.now() };
    pool.set(schoolId, entry);
    evictLruIfOverCap();
  } else {
    entry.lastUsed = Date.now();
  }
  return entry.client;
}

function evict(schoolId) {
  const entry = pool.get(schoolId);
  if (!entry) return;
  pool.delete(schoolId);
  entry.client.$disconnect().catch(err => {
    console.error(`[tenantPool] error disconnecting client for ${schoolId}:`, err.message);
  });
}

module.exports = { getOrOpen, evict };
