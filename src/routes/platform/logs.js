const router = require('express').Router();
const platformDb = require('../../db/platform');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');

const guard = [authenticatePlatform, authorizePlatform()];

// GET /api/platform/logs?limit=50&offset=0&action=school.created
router.get('/', ...guard, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  let sql = 'SELECT * FROM system_logs';
  const params = [];
  if (req.query.action) {
    sql += ' WHERE action = ?';
    params.push(req.query.action);
  }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = platformDb.prepare(sql).all(...params);
  const total = platformDb.prepare('SELECT COUNT(*) as c FROM system_logs').get().c;
  res.json({ rows, total, limit, offset });
});

module.exports = router;
