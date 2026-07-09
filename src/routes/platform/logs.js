const router = require('express').Router();
const platformClient = require('../../db/platformClient');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');

const guard = [authenticatePlatform, authorizePlatform()];

// GET /api/platform/logs?limit=50&offset=0&action=school.created
router.get('/', ...guard, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const where = req.query.action ? { action: req.query.action } : {};

  const [rows, total] = await Promise.all([
    platformClient.systemLog.findMany({ where, orderBy: { created_at: 'desc' }, take: limit, skip: offset }),
    platformClient.systemLog.count({ where }),
  ]);
  res.json({ rows, total, limit, offset });
});

module.exports = router;
