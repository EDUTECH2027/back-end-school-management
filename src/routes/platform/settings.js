const router = require('express').Router();
const platformDb = require('../../db/platform');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');
const { logAction } = require('./_helpers');

const guard = [authenticatePlatform, authorizePlatform()];

// GET /api/platform/settings
router.get('/', ...guard, (req, res) => {
  res.json(platformDb.prepare("SELECT * FROM platform_settings WHERE id='p1'").get());
});

// PUT /api/platform/settings
router.put('/', ...guard, (req, res) => {
  const current = platformDb.prepare("SELECT * FROM platform_settings WHERE id='p1'").get();
  const { platform_name, logo_url, support_email, default_plan_id } = req.body;
  platformDb.prepare(`
    UPDATE platform_settings SET platform_name=?, logo_url=?, support_email=?, default_plan_id=?, updated_at=datetime('now')
    WHERE id='p1'
  `).run(
    platform_name ?? current.platform_name,
    logo_url ?? current.logo_url,
    support_email ?? current.support_email,
    default_plan_id ?? current.default_plan_id
  );

  logAction(req, 'settings.updated', 'platform_settings', 'p1', {});
  res.json(platformDb.prepare("SELECT * FROM platform_settings WHERE id='p1'").get());
});

module.exports = router;
