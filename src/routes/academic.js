const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

// ── Academic Years ──────────────────────────────────────────────────

router.get('/years', authenticate, (_req, res) => {
  res.json(db.prepare('SELECT * FROM academic_years ORDER BY start_date DESC').all());
});

router.post('/years', authenticate, (req, res) => {
  const { label, start_date, end_date, is_current } = req.body;
  if (!label || !start_date || !end_date) return res.status(422).json({ error: 'label, start_date and end_date required' });
  if (is_current) db.prepare('UPDATE academic_years SET is_current=0').run();
  const id = uuid();
  db.prepare('INSERT INTO academic_years VALUES (?,?,?,?,?)').run(id, label, start_date, end_date, is_current ? 1 : 0);
  res.status(201).json(db.prepare('SELECT * FROM academic_years WHERE id=?').get(id));
});

router.put('/years/:id', authenticate, (req, res) => {
  const { label, start_date, end_date, is_current } = req.body;
  if (is_current) db.prepare('UPDATE academic_years SET is_current=0').run();
  db.prepare('UPDATE academic_years SET label=?,start_date=?,end_date=?,is_current=? WHERE id=?')
    .run(label, start_date, end_date, is_current ? 1 : 0, req.params.id);
  res.json(db.prepare('SELECT * FROM academic_years WHERE id=?').get(req.params.id));
});

// ── Terms ───────────────────────────────────────────────────────────

router.get('/terms', authenticate, (req, res) => {
  const { academic_year_id } = req.query;
  const rows = academic_year_id
    ? db.prepare('SELECT * FROM terms WHERE academic_year_id=? ORDER BY start_date').all(academic_year_id)
    : db.prepare('SELECT * FROM terms ORDER BY start_date').all();
  res.json(rows);
});

router.post('/terms', authenticate, (req, res) => {
  const { academic_year_id, name, start_date, end_date, is_current } = req.body;
  if (!academic_year_id || !name || !start_date || !end_date) return res.status(422).json({ error: 'Missing required fields' });
  if (is_current) db.prepare('UPDATE terms SET is_current=0').run();
  const id = uuid();
  db.prepare('INSERT INTO terms VALUES (?,?,?,?,?,?)').run(id, academic_year_id, name, start_date, end_date, is_current ? 1 : 0);
  res.status(201).json(db.prepare('SELECT * FROM terms WHERE id=?').get(id));
});

router.put('/terms/:id', authenticate, (req, res) => {
  const { name, start_date, end_date, is_current } = req.body;
  if (is_current) db.prepare('UPDATE terms SET is_current=0').run();
  db.prepare('UPDATE terms SET name=?,start_date=?,end_date=?,is_current=? WHERE id=?')
    .run(name, start_date, end_date, is_current ? 1 : 0, req.params.id);
  res.json(db.prepare('SELECT * FROM terms WHERE id=?').get(req.params.id));
});

// ── Grade Levels ────────────────────────────────────────────────────

router.get('/grade-levels', authenticate, (_req, res) => {
  res.json(db.prepare('SELECT * FROM grade_levels ORDER BY sort_order').all());
});

module.exports = router;
