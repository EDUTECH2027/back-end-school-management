const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');

// GET /api/school
router.get('/', authenticate, (_req, res) => {
  const row = db.prepare('SELECT * FROM school LIMIT 1').get();
  if (!row) return res.status(404).json({ error: 'School not found' });
  res.json(row);
});

// PUT /api/school
router.put('/', authenticate, (req, res) => {
  const { name, code, address, phone, email, head_teacher, motto, logo_url } = req.body;
  db.prepare(`
    UPDATE school SET name=?, code=?, address=?, phone=?, email=?,
    head_teacher=?, motto=?, logo_url=?, updated_at=datetime('now')
    WHERE id='s1'
  `).run(name, code, address, phone, email, head_teacher, motto, logo_url ?? null);
  res.json(db.prepare('SELECT * FROM school LIMIT 1').get());
});

module.exports = router;
