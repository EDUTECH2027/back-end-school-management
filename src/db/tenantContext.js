const { AsyncLocalStorage } = require('node:async_hooks');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const ALS = new AsyncLocalStorage();
const TENANTS_DIR = path.resolve(process.env.TENANTS_DIR || './data/tenants');
const MAX_OPEN = Number(process.env.MAX_OPEN_TENANT_DBS || 25);

if (!fs.existsSync(TENANTS_DIR)) fs.mkdirSync(TENANTS_DIR, { recursive: true });

// schoolId -> { conn, lastUsed }
const openConnections = new Map();

function pathFor(schoolId) {
  return path.join(TENANTS_DIR, `${schoolId}.db`);
}

function openRaw(schoolId) {
  const conn = new DatabaseSync(pathFor(schoolId));
  conn.exec('PRAGMA journal_mode = WAL');
  conn.exec('PRAGMA foreign_keys = ON');
  return conn;
}

function evictLruIfOverCap() {
  if (openConnections.size <= MAX_OPEN) return;
  let lruId = null;
  let lruTime = Infinity;
  for (const [id, entry] of openConnections) {
    if (entry.lastUsed < lruTime) { lruTime = entry.lastUsed; lruId = id; }
  }
  if (lruId) evict(lruId);
}

function getOrOpen(schoolId) {
  let entry = openConnections.get(schoolId);
  if (!entry) {
    entry = { conn: openRaw(schoolId), lastUsed: Date.now() };
    openConnections.set(schoolId, entry);
    evictLruIfOverCap();
  }
  entry.lastUsed = Date.now();
  return entry.conn;
}

function evict(schoolId) {
  const entry = openConnections.get(schoolId);
  if (!entry) return;
  try { entry.conn.close(); } catch (_) {}
  openConnections.delete(schoolId);
}

function currentConnection() {
  const store = ALS.getStore();
  if (!store || !store.schoolId) throw new Error('No tenant context established for this request');
  return getOrOpen(store.schoolId);
}

function runWithTenant(schoolId, fn) {
  return ALS.run({ schoolId }, fn);
}

module.exports = {
  ALS,
  TENANTS_DIR,
  runWithTenant,
  currentConnection,
  getOrOpen,
  evict,
  pathFor,
};
