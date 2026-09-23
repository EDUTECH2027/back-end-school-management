/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const { currentConnection } = require('./tenantContext');

// Wraps a SQL string; the real connection is resolved (and the statement
// compiled) lazily on first .get/.all/.run — by which point request-scoped
// tenant context (set by middleware/auth.js) is guaranteed to exist. Caching
// is keyed per connection object, so evicted/reopened tenants naturally miss
// and recompile without any explicit invalidation.
class LazyStatement {
  constructor(sql) {
    this.sql = sql;
    this._cache = new WeakMap();
  }
  _stmt() {
    const conn = currentConnection();
    let stmt = this._cache.get(conn);
    if (!stmt) {
      stmt = conn.prepare(this.sql);
      this._cache.set(conn, stmt);
    }
    return stmt;
  }
  get(...args) { return this._stmt().get(...args); }
  all(...args) { return this._stmt().all(...args); }
  run(...args) { return this._stmt().run(...args); }
}

const db = {
  prepare(sql) {
    return new LazyStatement(sql);
  },
  exec(sql) {
    return currentConnection().exec(sql);
  },
  // better-sqlite3-compatible transaction helper
  transaction(fn) {
    return (...args) => {
      const conn = currentConnection();
      conn.exec('BEGIN');
      try {
        const result = fn(...args);
        conn.exec('COMMIT');
        return result;
      } catch (e) {
        conn.exec('ROLLBACK');
        throw e;
      }
    };
  },
};

module.exports = db;
