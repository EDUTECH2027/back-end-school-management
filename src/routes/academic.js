/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

// ── Academic Years ──────────────────────────────────────────────────

router.get('/years', authenticate, async (req, res) => {
  res.json(await req.db.academicYear.findMany({ orderBy: { start_date: 'desc' } }));
});

router.post('/years', authenticate, async (req, res) => {
  const { label, start_date, end_date, is_current } = req.body;
  if (!label || !start_date || !end_date) return res.status(422).json({ error: 'label, start_date and end_date required' });
  if (is_current) await req.db.academicYear.updateMany({ data: { is_current: false } });
  const id = uuid();
  const created = await req.db.academicYear.create({ data: { id, label, start_date, end_date, is_current: !!is_current } });
  res.status(201).json(created);
});

router.put('/years/:id', authenticate, async (req, res) => {
  const { label, start_date, end_date, is_current } = req.body;
  if (is_current) await req.db.academicYear.updateMany({ data: { is_current: false } });
  const updated = await req.db.academicYear.update({
    where: { id: req.params.id },
    data: { label, start_date, end_date, is_current: !!is_current },
  });
  res.json(updated);
});

// ── Terms ───────────────────────────────────────────────────────────

router.get('/terms', authenticate, async (req, res) => {
  const { academic_year_id } = req.query;
  const where = academic_year_id ? { academic_year_id } : {};
  res.json(await req.db.term.findMany({ where, orderBy: { start_date: 'asc' } }));
});

router.post('/terms', authenticate, async (req, res) => {
  const { academic_year_id, name, start_date, end_date, is_current } = req.body;
  if (!academic_year_id || !name || !start_date || !end_date) return res.status(422).json({ error: 'Missing required fields' });
  if (is_current) await req.db.term.updateMany({ data: { is_current: false } });
  const id = uuid();
  const created = await req.db.term.create({ data: { id, academic_year_id, name, start_date, end_date, is_current: !!is_current } });
  res.status(201).json(created);
});

router.put('/terms/:id', authenticate, async (req, res) => {
  const { name, start_date, end_date, is_current } = req.body;
  if (is_current) await req.db.term.updateMany({ data: { is_current: false } });
  const updated = await req.db.term.update({
    where: { id: req.params.id },
    data: { name, start_date, end_date, is_current: !!is_current },
  });
  res.json(updated);
});

// ── Grade Levels ────────────────────────────────────────────────────

router.get('/grade-levels', authenticate, async (req, res) => {
  res.json(await req.db.gradeLevel.findMany({ orderBy: { sort_order: 'asc' } }));
});

module.exports = router;
