const db = require('./database');

function createSchema() {
  db.exec(`
    -- ── Users (auth) ────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK(role IN ('head_teacher','teacher','secretary','admin')),
      initials      TEXT NOT NULL,
      teacher_id    TEXT REFERENCES teachers(id) ON DELETE SET NULL,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    -- ── School ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS school (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      code          TEXT,
      address       TEXT,
      phone         TEXT,
      email         TEXT,
      head_teacher  TEXT,
      motto         TEXT,
      logo_url      TEXT,
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    -- ── Academic Years ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS academic_years (
      id         TEXT PRIMARY KEY,
      label      TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date   TEXT NOT NULL,
      is_current INTEGER DEFAULT 0
    );

    -- ── Terms ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS terms (
      id               TEXT PRIMARY KEY,
      academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
      name             TEXT NOT NULL CHECK(name IN ('first','second','third')),
      start_date       TEXT NOT NULL,
      end_date         TEXT NOT NULL,
      is_current       INTEGER DEFAULT 0
    );

    -- ── Grade Levels ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS grade_levels (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    -- ── Subjects ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS subjects (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE
    );

    -- ── Teachers ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS teachers (
      id             TEXT PRIMARY KEY,
      first_name     TEXT NOT NULL,
      last_name      TEXT NOT NULL,
      email          TEXT UNIQUE NOT NULL,
      phone          TEXT,
      gender         TEXT CHECK(gender IN ('male','female','other')),
      subjects       TEXT NOT NULL DEFAULT '[]',
      class_assigned TEXT,
      qualification  TEXT,
      join_date      TEXT,
      is_active      INTEGER DEFAULT 1,
      created_at     TEXT DEFAULT (datetime('now')),
      updated_at     TEXT DEFAULT (datetime('now'))
    );

    -- ── Classes ─────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS classes (
      id                TEXT PRIMARY KEY,
      grade_level_id    TEXT NOT NULL REFERENCES grade_levels(id),
      grade_level_name  TEXT NOT NULL,
      name              TEXT NOT NULL UNIQUE,
      capacity          INTEGER NOT NULL DEFAULT 40,
      room              TEXT,
      class_teacher_id  TEXT REFERENCES teachers(id) ON DELETE SET NULL,
      class_teacher_name TEXT,
      enrolled          INTEGER DEFAULT 0,
      created_at        TEXT DEFAULT (datetime('now'))
    );

    -- ── Students ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS students (
      id                      TEXT PRIMARY KEY,
      student_number          TEXT UNIQUE NOT NULL,
      first_name              TEXT NOT NULL,
      last_name               TEXT NOT NULL,
      date_of_birth           TEXT,
      gender                  TEXT CHECK(gender IN ('male','female','other')),
      class_id                TEXT REFERENCES classes(id) ON DELETE SET NULL,
      class_name              TEXT,
      grade_level_name        TEXT,
      photo_url               TEXT,
      guardian_name           TEXT,
      guardian_phone          TEXT,
      guardian_relationship   TEXT,
      admission_date          TEXT,
      is_active               INTEGER DEFAULT 1,
      address                 TEXT,
      created_at              TEXT DEFAULT (datetime('now')),
      updated_at              TEXT DEFAULT (datetime('now'))
    );

    -- ── Parents / Guardians ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS parents (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      email        TEXT,
      phone        TEXT NOT NULL,
      relationship TEXT,
      address      TEXT,
      occupation   TEXT,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS parent_students (
      parent_id  TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      PRIMARY KEY (parent_id, student_id)
    );

    -- ── Student Attendance ──────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS attendance_records (
      id             TEXT PRIMARY KEY,
      student_id     TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      student_name   TEXT,
      student_number TEXT,
      class_id       TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      class_name     TEXT,
      date           TEXT NOT NULL,
      status         TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')),
      remarks        TEXT,
      created_at     TEXT DEFAULT (datetime('now')),
      UNIQUE(student_id, date)
    );

    -- ── Teacher Attendance ──────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS teacher_attendance (
      id          TEXT PRIMARY KEY,
      teacher_id  TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      date        TEXT NOT NULL,
      status      TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')),
      remarks     TEXT,
      UNIQUE(teacher_id, date)
    );

    -- ── Timetable (Teacher Schedule) ────────────────────────────────
    CREATE TABLE IF NOT EXISTS teacher_schedule (
      id           TEXT PRIMARY KEY,
      teacher_id   TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      day          TEXT NOT NULL CHECK(day IN ('monday','tuesday','wednesday','thursday','friday')),
      period_key   TEXT NOT NULL,
      period_label TEXT,
      time         TEXT,
      class_id     TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      class_name   TEXT,
      subject_name TEXT NOT NULL,
      room         TEXT
    );

    -- ── Marks ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS marks (
      id             TEXT PRIMARY KEY,
      student_id     TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      student_name   TEXT,
      student_number TEXT,
      subject_id     TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      subject_name   TEXT,
      term_id        TEXT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
      class_id       TEXT REFERENCES classes(id) ON DELETE SET NULL,
      ca_score       REAL DEFAULT 0,
      exam_score     REAL DEFAULT 0,
      total_score    REAL DEFAULT 0,
      grade          TEXT,
      remark         TEXT,
      created_at     TEXT DEFAULT (datetime('now')),
      updated_at     TEXT DEFAULT (datetime('now')),
      UNIQUE(student_id, subject_id, term_id)
    );

    -- ── Report Cards ────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS report_cards (
      id                     TEXT PRIMARY KEY,
      student_id             TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      student_name           TEXT,
      student_number         TEXT,
      class_name             TEXT,
      grade_level_name       TEXT,
      term_id                TEXT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
      term_name              TEXT,
      academic_year          TEXT,
      total_marks_obtained   REAL DEFAULT 0,
      total_marks_possible   REAL DEFAULT 0,
      percentage             REAL DEFAULT 0,
      class_position         INTEGER,
      out_of                 INTEGER,
      days_present           INTEGER DEFAULT 0,
      days_absent            INTEGER DEFAULT 0,
      total_school_days      INTEGER DEFAULT 0,
      conduct                TEXT,
      class_teacher_comment  TEXT,
      head_teacher_comment   TEXT,
      status                 TEXT DEFAULT 'draft' CHECK(status IN ('draft','finalized','published','printed')),
      created_at             TEXT DEFAULT (datetime('now')),
      updated_at             TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS report_card_entries (
      id               TEXT PRIMARY KEY,
      report_card_id   TEXT NOT NULL REFERENCES report_cards(id) ON DELETE CASCADE,
      subject_id       TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      subject_name     TEXT,
      ca_score         REAL DEFAULT 0,
      exam_score       REAL DEFAULT 0,
      total_score      REAL DEFAULT 0,
      grade            TEXT,
      remark           TEXT,
      position         INTEGER,
      teacher_comment  TEXT
    );

    -- ── Fee Records ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS fee_records (
      id             TEXT PRIMARY KEY,
      student_id     TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      student_name   TEXT,
      student_number TEXT,
      class_id       TEXT REFERENCES classes(id) ON DELETE SET NULL,
      class_name     TEXT,
      fee_name       TEXT NOT NULL,
      academic_year  TEXT,
      amount_due     REAL NOT NULL DEFAULT 0,
      amount_paid    REAL NOT NULL DEFAULT 0,
      balance        REAL NOT NULL DEFAULT 0,
      status         TEXT DEFAULT 'pending' CHECK(status IN ('pending','partial','paid','overdue','waived')),
      due_date       TEXT,
      created_at     TEXT DEFAULT (datetime('now')),
      updated_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id             TEXT PRIMARY KEY,
      fee_record_id  TEXT NOT NULL REFERENCES fee_records(id) ON DELETE CASCADE,
      amount         REAL NOT NULL,
      method         TEXT,
      reference      TEXT,
      payment_date   TEXT,
      receipt_number TEXT,
      created_at     TEXT DEFAULT (datetime('now'))
    );

    -- ── Teacher Payroll ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS teacher_payroll (
      id                  TEXT PRIMARY KEY,
      teacher_id          TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      month               TEXT NOT NULL,
      hourly_rate         REAL DEFAULT 3500,
      contracted_hours    REAL DEFAULT 80,
      base_allowance      REAL DEFAULT 50000,
      absence_deduction   REAL DEFAULT 12000,
      late_deduction      REAL DEFAULT 2500,
      hours_worked        REAL DEFAULT 0,
      absences            INTEGER DEFAULT 0,
      late_coming         INTEGER DEFAULT 0,
      bonus               REAL DEFAULT 0,
      notes               TEXT DEFAULT '',
      status              TEXT DEFAULT 'draft' CHECK(status IN ('draft','pending','paid')),
      created_at          TEXT DEFAULT (datetime('now')),
      updated_at          TEXT DEFAULT (datetime('now')),
      UNIQUE(teacher_id, month)
    );

    -- ── Announcements ────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS announcements (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      author     TEXT,
      author_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
      audience   TEXT DEFAULT 'all',
      is_pinned  INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ── Email Alerts ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS email_alerts (
      id          TEXT PRIMARY KEY,
      subject     TEXT NOT NULL,
      body        TEXT NOT NULL,
      recipient   TEXT NOT NULL,
      sender      TEXT,
      sender_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
      status      TEXT DEFAULT 'sent' CHECK(status IN ('sent','delivered','failed','draft')),
      sent_at     TEXT DEFAULT (datetime('now'))
    );

    -- ── Discussion Forums ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS forum_threads (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      tag          TEXT DEFAULT 'general',
      author       TEXT,
      author_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
      is_pinned    INTEGER DEFAULT 0,
      message_count INTEGER DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS forum_messages (
      id          TEXT PRIMARY KEY,
      thread_id   TEXT NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
      author      TEXT NOT NULL,
      author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
      type        TEXT DEFAULT 'text' CHECK(type IN ('text','image','voice')),
      content     TEXT,
      image_url   TEXT,
      voice_url   TEXT,
      voice_duration INTEGER,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- ── Indexes ──────────────────────────────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_students_class     ON students(class_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_date    ON attendance_records(date);
    CREATE INDEX IF NOT EXISTS idx_attendance_class   ON attendance_records(class_id);
    CREATE INDEX IF NOT EXISTS idx_marks_student      ON marks(student_id);
    CREATE INDEX IF NOT EXISTS idx_marks_term         ON marks(term_id);
    CREATE INDEX IF NOT EXISTS idx_fee_student        ON fee_records(student_id);
    CREATE INDEX IF NOT EXISTS idx_payroll_month      ON teacher_payroll(month);
    CREATE INDEX IF NOT EXISTS idx_schedule_teacher   ON teacher_schedule(teacher_id);
  `);

  // Migrations for databases created before updated_at was added to marks
  try { db.exec(`ALTER TABLE marks ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))`); } catch (_) {}
  // Add type column to announcements (info / warning / success)
  try { db.exec(`ALTER TABLE announcements ADD COLUMN type TEXT DEFAULT 'info'`); } catch (_) {}

  // Make grade_level_id nullable on classes (remove NOT NULL + FK constraint)
  const classGlCol = db.prepare("PRAGMA table_info(classes)").all().find(c => c.name === 'grade_level_id');
  if (classGlCol && classGlCol.notnull === 1) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`
      CREATE TABLE classes_new (
        id                 TEXT PRIMARY KEY,
        grade_level_id     TEXT,
        grade_level_name   TEXT,
        name               TEXT NOT NULL UNIQUE,
        capacity           INTEGER NOT NULL DEFAULT 40,
        room               TEXT,
        class_teacher_id   TEXT REFERENCES teachers(id) ON DELETE SET NULL,
        class_teacher_name TEXT,
        enrolled           INTEGER DEFAULT 0,
        created_at         TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO classes_new SELECT * FROM classes;
      DROP TABLE classes;
      ALTER TABLE classes_new RENAME TO classes;
    `);
    db.exec('PRAGMA foreign_keys = ON');
  }

  // ── Role-based portal migration ──────────────────────────────────────
  // Recreate users table with new roles + student_id/parent_id columns
  const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!userCols.includes('student_id')) {
    // Strategy: create users_new, copy data, DROP old users (FK off so other tables'
    // DDL stays pointing at "users"), then rename users_new → users.
    // Avoids the node:sqlite 3.51+ behavior where RENAME rewrites FK refs in other
    // tables' DDL, which breaks them after the temp table is dropped.
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`
      CREATE TABLE users_new (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        email         TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL CHECK(role IN ('super_admin','head_teacher','teacher','student','parent')),
        initials      TEXT NOT NULL,
        teacher_id    TEXT REFERENCES teachers(id) ON DELETE SET NULL,
        student_id    TEXT REFERENCES students(id) ON DELETE SET NULL,
        parent_id     TEXT REFERENCES parents(id)  ON DELETE SET NULL,
        created_at    TEXT DEFAULT (datetime('now')),
        updated_at    TEXT DEFAULT (datetime('now'))
      );

      INSERT INTO users_new (id,name,email,password_hash,role,initials,teacher_id,created_at,updated_at)
        SELECT id,name,email,password_hash,
          CASE WHEN role='head_teacher' THEN 'super_admin' ELSE role END,
          initials,teacher_id,created_at,updated_at
        FROM users;

      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    db.exec('PRAGMA foreign_keys = ON');
  }

  // Add user_id to entity tables (idempotent via try/catch)
  try { db.exec('ALTER TABLE teachers ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL'); } catch (_) {}
  try { db.exec('ALTER TABLE students ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL'); } catch (_) {}
  try { db.exec('ALTER TABLE parents  ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL'); } catch (_) {}

  // ── Student Behavior log ─────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_behavior (
      id           TEXT PRIMARY KEY,
      student_id   TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      class_id     TEXT REFERENCES classes(id) ON DELETE SET NULL,
      teacher_id   TEXT REFERENCES teachers(id) ON DELETE SET NULL,
      date         TEXT NOT NULL,
      category     TEXT NOT NULL CHECK(category IN ('positive','negative','neutral')),
      description  TEXT NOT NULL,
      action_taken TEXT,
      created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_behavior_student ON student_behavior(student_id);
    CREATE INDEX IF NOT EXISTS idx_behavior_class   ON student_behavior(class_id);
  `);

  // ── Salary Withdrawal Requests ────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS salary_withdrawals (
      id          TEXT PRIMARY KEY,
      teacher_id  TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      payroll_id  TEXT REFERENCES teacher_payroll(id) ON DELETE SET NULL,
      amount      REAL NOT NULL,
      reason      TEXT,
      status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TEXT,
      notes       TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_withdrawals_teacher ON salary_withdrawals(teacher_id);
  `);
}

module.exports = { createSchema };
