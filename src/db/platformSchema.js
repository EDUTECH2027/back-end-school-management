/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
function createPlatformSchema(db) {
  db.exec(`
    -- ── Subscription Plans ──────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL UNIQUE,
      price          REAL NOT NULL DEFAULT 0,
      billing_cycle  TEXT NOT NULL DEFAULT 'monthly' CHECK(billing_cycle IN ('monthly','yearly')),
      max_students   INTEGER,
      max_teachers   INTEGER,
      features       TEXT NOT NULL DEFAULT '[]',
      is_custom      INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT DEFAULT (datetime('now')),
      updated_at     TEXT DEFAULT (datetime('now'))
    );

    -- ── Schools (tenant registry) ────────────────────────────────────
    CREATE TABLE IF NOT EXISTS schools (
      id                   TEXT PRIMARY KEY,
      name                 TEXT NOT NULL,
      code                 TEXT,
      address              TEXT,
      phone                TEXT,
      email                TEXT NOT NULL,
      admin_name           TEXT NOT NULL,
      admin_email          TEXT NOT NULL,
      plan_id              TEXT REFERENCES subscription_plans(id) ON DELETE SET NULL,
      status               TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','suspended','archived')),
      subscription_started TEXT DEFAULT (datetime('now')),
      subscription_expiry  TEXT,
      created_at           TEXT DEFAULT (datetime('now')),
      updated_at           TEXT DEFAULT (datetime('now'))
    );

    -- ── Platform Admins ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS platform_admins (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'platform_admin' CHECK(role IN ('platform_owner','platform_admin')),
      initials      TEXT NOT NULL,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    -- ── Cross-tenant login routing index ──────────────────────────────
    CREATE TABLE IF NOT EXISTS user_directory (
      email      TEXT PRIMARY KEY,
      school_id  TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      role       TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ── System Logs ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS system_logs (
      id          TEXT PRIMARY KEY,
      actor_type  TEXT NOT NULL DEFAULT 'platform_admin' CHECK(actor_type IN ('platform_admin','system')),
      actor_id    TEXT,
      actor_name  TEXT,
      action      TEXT NOT NULL,
      target_type TEXT,
      target_id   TEXT,
      meta        TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- ── Platform Announcements ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS platform_announcements (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      is_pinned  INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ── Platform Settings (singleton) ──────────────────────────────────
    CREATE TABLE IF NOT EXISTS platform_settings (
      id               TEXT PRIMARY KEY,
      platform_name    TEXT NOT NULL DEFAULT 'School Management System',
      logo_url         TEXT,
      support_email    TEXT,
      default_plan_id  TEXT REFERENCES subscription_plans(id) ON DELETE SET NULL,
      updated_at       TEXT DEFAULT (datetime('now'))
    );

    -- ── Feature lookup ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS features (
      id          TEXT PRIMARY KEY,
      key         TEXT UNIQUE NOT NULL,
      label       TEXT NOT NULL,
      description TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_schools_status  ON schools(status);
    CREATE INDEX IF NOT EXISTS idx_schools_plan    ON schools(plan_id);
    CREATE INDEX IF NOT EXISTS idx_directory_school ON user_directory(school_id);
    CREATE INDEX IF NOT EXISTS idx_logs_created    ON system_logs(created_at);
  `);

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM subscription_plans').get();
  if (n === 0) {
    const insPlan = db.prepare(`
      INSERT INTO subscription_plans (id, name, price, billing_cycle, max_students, max_teachers, features, is_custom)
      VALUES (?,?,?,?,?,?,?,0)
    `);
    insPlan.run('plan-basic',    'Basic',    29,  'monthly', 200,  15,  '["core"]');
    insPlan.run('plan-standard', 'Standard', 79,  'monthly', 800,  60,  '["core","report_cards","fees"]');
    insPlan.run('plan-premium',  'Premium',  149, 'monthly', null, null,'["core","report_cards","fees","payroll","forums"]');
  }

  const settings = db.prepare('SELECT id FROM platform_settings WHERE id=?').get('p1');
  if (!settings) {
    db.prepare(`INSERT INTO platform_settings (id, platform_name, updated_at) VALUES ('p1','School Management System', datetime('now'))`).run();
  }

  const { n: fN } = db.prepare('SELECT COUNT(*) AS n FROM features').get();
  if (fN === 0) {
    const insFeature = db.prepare('INSERT INTO features (id, key, label, description) VALUES (?,?,?,?)');
    insFeature.run('feat-core',    'core',          'Core Academics',   'Students, classes, attendance, marks, timetable');
    insFeature.run('feat-reports', 'report_cards',  'Report Cards',     'Automated report card generation');
    insFeature.run('feat-fees',    'fees',          'Fee Management',   'Fee records, payments and receipts');
    insFeature.run('feat-payroll', 'payroll',       'Teacher Payroll',  'Payroll and salary withdrawal requests');
    insFeature.run('feat-forums',  'forums',        'Discussion Forums','Announcements, email alerts and forums');
  }
}

module.exports = { createPlatformSchema };
