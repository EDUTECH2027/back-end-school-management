/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const withChildren = (parent) => {
  if (!parent) return null;
  const { children, ...rest } = parent;
  return { ...rest, children: (children || []).map(c => c.student) };
};

const CHILDREN_INCLUDE = { children: { include: { student: true } } };

router.get('/', authenticate, async (req, res) => {
  const { search } = req.query;
  const where = search
    ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search, mode: 'insensitive' } }] }
    : {};
  const rows = await req.db.parent.findMany({ where, include: CHILDREN_INCLUDE, orderBy: { name: 'asc' } });
  res.json(rows.map(withChildren));
});

router.get('/:id', authenticate, async (req, res) => {
  const row = await req.db.parent.findUnique({ where: { id: req.params.id }, include: CHILDREN_INCLUDE });
  if (!row) return res.status(404).json({ error: 'Parent not found' });
  res.json(withChildren(row));
});

router.post('/', authenticate, async (req, res) => {
  const { name, email, phone, relationship, address, occupation, studentIds = [] } = req.body;
  if (!name || !phone) return res.status(422).json({ error: 'name and phone required' });
  const id = uuid();
  await req.db.parent.create({ data: { id, name, email: email || null, phone, relationship: relationship || null, address: address || null, occupation: occupation || null } });
  if (studentIds.length) {
    await req.db.parentStudent.createMany({ data: studentIds.map(sid => ({ parent_id: id, student_id: sid })), skipDuplicates: true });
  }
  const created = await req.db.parent.findUnique({ where: { id }, include: CHILDREN_INCLUDE });
  res.status(201).json(withChildren(created));
});

router.put('/:id', authenticate, async (req, res) => {
  const { name, email, phone, relationship, address, occupation, studentIds } = req.body;
  await req.db.parent.update({
    where: { id: req.params.id },
    data: { name, email: email || null, phone, relationship: relationship || null, address: address || null, occupation: occupation || null, updated_at: new Date() },
  });
  if (Array.isArray(studentIds)) {
    await req.db.parentStudent.deleteMany({ where: { parent_id: req.params.id } });
    if (studentIds.length) {
      await req.db.parentStudent.createMany({ data: studentIds.map(sid => ({ parent_id: req.params.id, student_id: sid })), skipDuplicates: true });
    }
  }
  const updated = await req.db.parent.findUnique({ where: { id: req.params.id }, include: CHILDREN_INCLUDE });
  res.json(withChildren(updated));
});

router.delete('/:id', authenticate, async (req, res) => {
  await req.db.parent.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
