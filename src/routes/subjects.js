/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

router.get('/', authenticate, async (req, res) => {
  res.json(await req.db.subject.findMany({ orderBy: { name: 'asc' } }));
});

// A coefficient must be a positive number; anything else (missing, 0, negative,
// non-numeric) falls back to 1 so a bad value can't zero out or invert a
// subject's weight in the averaging math.
const parseCoefficient = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

router.post('/', authenticate, async (req, res) => {
  const { name, code, coefficient } = req.body;
  if (!name || !code) return res.status(422).json({ error: 'name and code required' });
  const id = uuid();
  const created = await req.db.subject.create({ data: { id, name, code, coefficient: parseCoefficient(coefficient) } });
  res.status(201).json(created);
});

router.put('/:id', authenticate, async (req, res) => {
  const { name, code, coefficient } = req.body;
  const updated = await req.db.subject.update({
    where: { id: req.params.id },
    data: { name, code, coefficient: parseCoefficient(coefficient) },
  });
  res.json(updated);
});

router.delete('/:id', authenticate, async (req, res) => {
  await req.db.subject.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
