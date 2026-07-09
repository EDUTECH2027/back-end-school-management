const router = require('express').Router();
const platformClient = require('../../db/platformClient');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');
const { logAction } = require('./_helpers');

const guard = [authenticatePlatform, authorizePlatform()];

// GET /api/platform/settings
router.get('/', ...guard, async (req, res) => {
  res.json(await platformClient.platformSetting.findUnique({ where: { id: 'p1' } }));
});

// PUT /api/platform/settings
router.put('/', ...guard, async (req, res) => {
  const current = await platformClient.platformSetting.findUnique({ where: { id: 'p1' } });
  const { platform_name, logo_url, support_email, default_plan_id } = req.body;
  const updated = await platformClient.platformSetting.update({
    where: { id: 'p1' },
    data: {
      platform_name: platform_name ?? current.platform_name,
      logo_url: logo_url ?? current.logo_url,
      support_email: support_email ?? current.support_email,
      default_plan_id: default_plan_id ?? current.default_plan_id,
      updated_at: new Date(),
    },
  });

  await logAction(req, 'settings.updated', 'platform_settings', 'p1', {});
  res.json(updated);
});

module.exports = router;
