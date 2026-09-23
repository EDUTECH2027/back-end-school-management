/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

router.get('/', authenticate, async (req, res) => {
  const { audience, isPinned } = req.query;
  const where = {};
  if (audience) where.OR = [{ audience }, { audience: 'all' }];
  if (isPinned !== undefined) where.is_pinned = isPinned === 'true';
  const rows = await req.db.announcement.findMany({ where, orderBy: [{ is_pinned: 'desc' }, { created_at: 'desc' }] });
  res.json(rows);
});

router.get('/:id', authenticate, async (req, res) => {
  const row = await req.db.announcement.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'Announcement not found' });
  res.json(row);
});

router.post('/', authenticate, async (req, res) => {
  const { title, body, audience, isPinned, type } = req.body;
  if (!title || !body) return res.status(422).json({ error: 'title and body required' });
  const id = uuid();
  const created = await req.db.announcement.create({
    data: { id, title, body, author: req.user.name, author_id: req.user.id, audience: audience || 'all', is_pinned: !!isPinned, type: type || 'info' },
  });
  res.status(201).json(created);
});

router.put('/:id', authenticate, async (req, res) => {
  const { title, body, audience, isPinned, type } = req.body;
  const updated = await req.db.announcement.update({
    where: { id: req.params.id },
    data: { title, body, audience: audience || 'all', is_pinned: !!isPinned, type: type || 'info', updated_at: new Date() },
  });
  res.json(updated);
});

router.delete('/:id', authenticate, async (req, res) => {
  await req.db.announcement.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
