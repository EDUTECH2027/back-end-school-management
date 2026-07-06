const router = require('express').Router();
const platformDb = require('../../db/platform');
const { runWithTenant } = require('../../db/tenantContext');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');

const guard = [authenticatePlatform, authorizePlatform()];

// GET /api/platform/users — read-only aggregate across every tenant DB
router.get('/', ...guard, (req, res) => {
  const schools = platformDb.prepare('SELECT id, name FROM schools').all();
  const all = [];

  for (const school of schools) {
    try {
      const rows = runWithTenant(school.id, () => {
        const db = require('../../db/database');
        return db.prepare('SELECT id, name, email, role, initials, created_at FROM users ORDER BY name').all();
      });
      for (const r of rows) all.push({ ...r, school_id: school.id, school_name: school.name });
    } catch (_) {
      // tenant db unreadable/missing — skip rather than fail the whole aggregate
    }
  }

  res.json(all);
});

module.exports = router;
