const router = require('express').Router();
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');

function computeStatus(row) {
  const is_enabled = row?.is_enabled ?? false;
  const opens_at = row?.opens_at ?? null;
  const closes_at = row?.closes_at ?? null;

  let is_open = true;
  if (is_enabled) {
    const now = new Date();
    is_open = (!opens_at || now >= opens_at) && (!closes_at || now <= closes_at);
  }

  return { is_enabled, opens_at, closes_at, is_open };
}

async function getMarksEntryStatus(db) {
  const row = await db.marksEntryPeriod.findUnique({ where: { id: 's1' } });
  return computeStatus(row);
}

// GET /api/marks-settings — any authenticated user (admin settings page + teacher portal both read this)
router.get('/', authenticate, async (req, res) => {
  const row = await req.db.marksEntryPeriod.findUnique({ where: { id: 's1' } });
  res.json(computeStatus(row));
});

// PUT /api/marks-settings — admin only
router.put('/', authenticate, authorize('super_admin'), async (req, res) => {
  const { is_enabled, opens_at, closes_at } = req.body;
  const row = await req.db.marksEntryPeriod.upsert({
    where: { id: 's1' },
    update: {
      is_enabled: is_enabled ?? false,
      opens_at: opens_at ? new Date(opens_at) : null,
      closes_at: closes_at ? new Date(closes_at) : null,
      updated_at: new Date(),
    },
    create: {
      id: 's1',
      is_enabled: is_enabled ?? false,
      opens_at: opens_at ? new Date(opens_at) : null,
      closes_at: closes_at ? new Date(closes_at) : null,
    },
  });
  res.json(computeStatus(row));
});

module.exports = router;
module.exports.getMarksEntryStatus = getMarksEntryStatus;
