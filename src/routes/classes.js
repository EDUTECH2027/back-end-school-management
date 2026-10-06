/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');
const { resolveClasses, classKey } = require('../utils/classMatching');

router.get('/', authenticate, async (req, res) => {
  const { grade_level_id } = req.query;
  const where = grade_level_id ? { grade_level_id } : {};
  res.json(await req.db.class.findMany({ where, orderBy: { name: 'asc' } }));
});

// POST /api/classes/sync-from-students — repairs students that carry a class name as text but
// aren't linked to a class record (e.g. imported before class matching existed): creates the
// missing classes, links the students, and refreshes each class's headcount.
router.post('/sync-from-students', authenticate, async (req, res) => {
  const orphans = await req.db.student.findMany({
    where: { class_id: null, class_name: { not: null } },
    select: { id: true, class_name: true },
  });
  const withName = orphans.filter(s => s.class_name && s.class_name.trim());
  if (withName.length === 0) return res.json({ linked: 0, createdClasses: [], unmatched: [] });

  const { byKey, created, unmatched } = await resolveClasses(req.db, withName.map(s => s.class_name), { createMissing: true });

  const idsByClass = new Map();
  for (const st of withName) {
    const match = byKey.get(classKey(st.class_name));
    if (!match) continue;
    if (!idsByClass.has(match.id)) idsByClass.set(match.id, { match, ids: [] });
    idsByClass.get(match.id).ids.push(st.id);
  }
  let linked = 0;
  for (const [classId, { match, ids }] of idsByClass) {
    const r = await req.db.student.updateMany({
      where: { id: { in: ids } },
      data: { class_id: classId, class_name: match.name, grade_level_name: match.grade_level_name || undefined },
    });
    linked += r.count;
    const enrolled = await req.db.student.count({ where: { class_id: classId } });
    await req.db.class.update({ where: { id: classId }, data: { enrolled } });
  }
  res.json({ linked, createdClasses: created, unmatched });
});

router.get('/:id', authenticate, async (req, res) => {
  const row = await req.db.class.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'Class not found' });
  res.json(row);
});

router.post('/', authenticate, async (req, res) => {
  const { grade_level_id, grade_level_name, name, capacity, room, class_teacher_id, class_teacher_name } = req.body;
  if (!name) return res.status(422).json({ error: 'name required' });
  const id = uuid();
  const created = await req.db.class.create({
    data: {
      id, grade_level_id: grade_level_id || null, grade_level_name: grade_level_name || null, name,
      capacity: capacity || 40, room: room || null,
      class_teacher_id: class_teacher_id || null, class_teacher_name: class_teacher_name || null, enrolled: 0,
    },
  });
  res.status(201).json(created);
});

router.put('/:id', authenticate, async (req, res) => {
  const { grade_level_id, grade_level_name, name, capacity, room, class_teacher_id, class_teacher_name, enrolled } = req.body;
  const updated = await req.db.class.update({
    where: { id: req.params.id },
    data: {
      grade_level_id, grade_level_name, name, capacity, room: room || null,
      class_teacher_id: class_teacher_id || null, class_teacher_name: class_teacher_name || null,
      enrolled: enrolled || 0,
    },
  });
  res.json(updated);
});

router.delete('/:id', authenticate, async (req, res) => {
  await req.db.class.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

// GET /api/classes/:id/students
router.get('/:id/students', authenticate, async (req, res) => {
  const rows = await req.db.student.findMany({
    where: { class_id: req.params.id, is_active: true },
    orderBy: { first_name: 'asc' },
  });
  res.json(rows);
});

module.exports = router;
