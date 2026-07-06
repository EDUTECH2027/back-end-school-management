const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dbPath = path.resolve(process.env.PLATFORM_DB_PATH || './data/platform.db');
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const platformDb = new DatabaseSync(dbPath);
platformDb.exec('PRAGMA journal_mode = WAL');
platformDb.exec('PRAGMA foreign_keys = ON');

platformDb.transaction = (fn) => (...args) => {
  platformDb.exec('BEGIN');
  try {
    const result = fn(...args);
    platformDb.exec('COMMIT');
    return result;
  } catch (e) {
    platformDb.exec('ROLLBACK');
    throw e;
  }
};

module.exports = platformDb;
