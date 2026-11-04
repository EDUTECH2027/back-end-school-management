/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { v4: uuid } = require('uuid');
const { coefficientsFor } = require('../utils/coefficients');

router.get('/', authenticate, async (req, res) => {
  res.json(await req.db.subject.findMany({ orderBy: { name: 'asc' } }));
});

// GET /api/subjects/coefficients?classId=… — the coefficient each subject really carries in that
// class (override or default). Without classId: the plain defaults.
router.get('/coefficients', authenticate, async (req, res) => {
  res.json(await coefficientsFor(req.db, { classId: req.query.classId || null }));
});

// GET /api/subjects/coefficient-overrides — every override, for the Settings grid.
router.get('/coefficient-overrides', authenticate, async (req, res) => {
  const rows = await req.db.subjectCoefficientOverride.findMany();
  res.json(rows.map(r => ({ id: r.id, subjectId: r.subject_id, classId: r.class_id, gradeLevelId: r.grade_level_id, coefficient: r.coefficient })));
});

// PUT /api/subjects/:id/coefficient-overrides  { overrides: [{ classId | gradeLevelId, coefficient }] }
// Replaces the subject's whole override set atomically; an empty list clears them (back to the default).
router.put('/:id/coefficient-overrides', authenticate, authorize('super_admin'), async (req, res) => {
  const subject = await req.db.subject.findUnique({ where: { id: req.params.id } });
  if (!subject) return res.status(404).json({ error: 'Subject not found' });
  const list = req.body.overrides;
  if (!Array.isArray(list)) return res.status(422).json({ error: 'overrides must be an array' });

  const seen = new Set();
  const data = [];
  for (const o of list) {
    const classId = o.classId || null;
    const gradeLevelId = o.gradeLevelId || null;
    const coefficient = Number(o.coefficient);
    if (!!classId === !!gradeLevelId) return res.status(422).json({ error: 'Each override needs exactly one of classId or gradeLevelId' });
    if (!Number.isFinite(coefficient) || coefficient <= 0) return res.status(422).json({ error: 'Each coefficient must be a positive number' });
    const key = classId ? `c:${classId}` : `g:${gradeLevelId}`;
    if (seen.has(key)) return res.status(422).json({ error: 'Duplicate override for the same class or grade level' });
    seen.add(key);
    data.push({ id: uuid(), subject_id: subject.id, class_id: classId, grade_level_id: gradeLevelId, coefficient });
  }
  const classIds = data.map(d => d.class_id).filter(Boolean);
  const gradeIds = data.map(d => d.grade_level_id).filter(Boolean);
  if (classIds.length && (await req.db.class.count({ where: { id: { in: classIds } } })) !== classIds.length) return res.status(422).json({ error: 'Unknown class' });
  if (gradeIds.length && (await req.db.gradeLevel.count({ where: { id: { in: gradeIds } } })) !== gradeIds.length) return res.status(422).json({ error: 'Unknown grade level' });

  await req.db.$transaction([
    req.db.subjectCoefficientOverride.deleteMany({ where: { subject_id: subject.id } }),
    req.db.subjectCoefficientOverride.createMany({ data }),
  ]);
  res.json(data.map(d => ({ subjectId: d.subject_id, classId: d.class_id, gradeLevelId: d.grade_level_id, coefficient: d.coefficient })));
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
