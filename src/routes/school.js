const router = require('express').Router();
const authenticate = require('../middleware/auth');

// GET /api/school
router.get('/', authenticate, async (req, res) => {
  const row = await req.db.school.findFirst();
  if (!row) return res.status(404).json({ error: 'School not found' });
  res.json(row);
});

// PUT /api/school
router.put('/', authenticate, async (req, res) => {
  const { name, code, address, phone, email, head_teacher, motto, logo_url } = req.body;
  await req.db.school.update({
    where: { id: 's1' },
    data: { name, code, address, phone, email, head_teacher, motto, logo_url: logo_url ?? null, updated_at: new Date() },
  });
  res.json(await req.db.school.findFirst());
});

module.exports = router;
