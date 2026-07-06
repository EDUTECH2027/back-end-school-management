const router = require('express').Router();
const platformDb = require('../../db/platform');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');

const guard = [authenticatePlatform, authorizePlatform()];

// GET /api/platform/reports/schools-by-status
router.get('/schools-by-status', ...guard, (req, res) => {
  res.json(platformDb.prepare('SELECT status, COUNT(*) as count FROM schools GROUP BY status').all());
});

// GET /api/platform/reports/revenue-by-plan
router.get('/revenue-by-plan', ...guard, (req, res) => {
  res.json(platformDb.prepare(`
    SELECT p.name as plan_name, p.price, COUNT(s.id) as school_count, p.price * COUNT(s.id) as revenue
    FROM subscription_plans p LEFT JOIN schools s ON s.plan_id = p.id AND s.status = 'active'
    GROUP BY p.id ORDER BY revenue DESC
  `).all());
});

// GET /api/platform/reports/signups-by-month
router.get('/signups-by-month', ...guard, (req, res) => {
  res.json(platformDb.prepare(`
    SELECT substr(created_at, 1, 7) as month, COUNT(*) as count
    FROM schools GROUP BY month ORDER BY month
  `).all());
});

module.exports = router;
