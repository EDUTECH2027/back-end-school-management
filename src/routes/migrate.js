const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');

const DEFAULT_PASSWORD = 'Welcome@2025';

// POST /api/migrate/portal-accounts
// Idempotent: creates portal user accounts for all teachers/students/parents that don't have one yet.
router.post('/portal-accounts', authenticate, authorize('super_admin', 'head_teacher'), (req, res) => {
  const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);

  const result = { teachers: { created: 0, skipped: 0 }, students: { created: 0, skipped: 0 }, parents: { created: 0, skipped: 0 } };

  const migrate = db.transaction(() => {
    // ── Teachers ─────────────────────────────────────────────────────
    const teachers = db.prepare('SELECT * FROM teachers WHERE is_active=1').all();
    for (const t of teachers) {
      if (t.user_id) { result.teachers.skipped++; continue; }
      const email = t.email;
      const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
      if (existing) {
        db.prepare("UPDATE teachers SET user_id=?, updated_at=datetime('now') WHERE id=?").run(existing.id, t.id);
        result.teachers.skipped++;
        continue;
      }
      const userId = uuid();
      const initials = `${t.first_name[0]}${t.last_name[0]}`.toUpperCase();
      db.prepare(`INSERT INTO users (id,name,email,password_hash,role,initials,teacher_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
        .run(userId, `${t.first_name} ${t.last_name}`, email, hash, 'teacher', initials, t.id);
      db.prepare("UPDATE teachers SET user_id=?, updated_at=datetime('now') WHERE id=?").run(userId, t.id);
      result.teachers.created++;
    }

    // ── Students ─────────────────────────────────────────────────────
    const students = db.prepare('SELECT * FROM students WHERE is_active=1').all();
    for (const s of students) {
      if (s.user_id) { result.students.skipped++; continue; }
      const email = `${s.student_number.toLowerCase().replace(/-/g, '')}@school.local`;
      const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
      if (existing) {
        db.prepare("UPDATE students SET user_id=?, updated_at=datetime('now') WHERE id=?").run(existing.id, s.id);
        result.students.skipped++;
        continue;
      }
      const userId = uuid();
      const initials = `${s.first_name[0]}${s.last_name[0]}`.toUpperCase();
      db.prepare(`INSERT INTO users (id,name,email,password_hash,role,initials,student_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
        .run(userId, `${s.first_name} ${s.last_name}`, email, hash, 'student', initials, s.id);
      db.prepare("UPDATE students SET user_id=?, updated_at=datetime('now') WHERE id=?").run(userId, s.id);
      result.students.created++;
    }

    // ── Parents ──────────────────────────────────────────────────────
    const parents = db.prepare('SELECT * FROM parents').all();
    for (const p of parents) {
      if (p.user_id) { result.parents.skipped++; continue; }
      const email = p.email || `${p.id}@school.local`;
      const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
      if (existing) {
        db.prepare("UPDATE parents SET user_id=?, updated_at=datetime('now') WHERE id=?").run(existing.id, p.id);
        result.parents.skipped++;
        continue;
      }
      const userId = uuid();
      const initials = p.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3);
      db.prepare(`INSERT INTO users (id,name,email,password_hash,role,initials,parent_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
        .run(userId, p.name, email, hash, 'parent', initials, p.id);
      db.prepare("UPDATE parents SET user_id=?, updated_at=datetime('now') WHERE id=?").run(userId, p.id);
      result.parents.created++;
    }
  });

  migrate();
  res.json({ success: true, defaultPassword: DEFAULT_PASSWORD, result });
});

module.exports = router;
