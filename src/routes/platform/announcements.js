const router = require('express').Router();
const { v4: uuid } = require('uuid');
const platformDb = require('../../db/platform');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');
const { logAction } = require('./_helpers');

const guard = [authenticatePlatform, authorizePlatform()];

// GET /api/platform/announcements
router.get('/', ...guard, (req, res) => {
  res.json(platformDb.prepare('SELECT * FROM platform_announcements ORDER BY is_pinned DESC, created_at DESC').all());
});

// POST /api/platform/announcements
router.post('/', ...guard, (req, res) => {
  const { title, body, is_pinned } = req.body;
  if (!title || !body) return res.status(422).json({ error: 'title and body are required' });

  const id = uuid();
  platformDb.prepare(`
    INSERT INTO platform_announcements (id, title, body, is_pinned, created_at, updated_at)
    VALUES (?,?,?,?,datetime('now'),datetime('now'))
  `).run(id, title, body, is_pinned ? 1 : 0);

  logAction(req, 'announcement.created', 'platform_announcement', id, { title });
  res.status(201).json(platformDb.prepare('SELECT * FROM platform_announcements WHERE id=?').get(id));
});

// PUT /api/platform/announcements/:id
router.put('/:id', ...guard, (req, res) => {
  const current = platformDb.prepare('SELECT * FROM platform_announcements WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Announcement not found' });

  const { title, body, is_pinned } = req.body;
  platformDb.prepare(`
    UPDATE platform_announcements SET title=?, body=?, is_pinned=?, updated_at=datetime('now') WHERE id=?
  `).run(title ?? current.title, body ?? current.body, is_pinned !== undefined ? (is_pinned ? 1 : 0) : current.is_pinned, req.params.id);

  res.json(platformDb.prepare('SELECT * FROM platform_announcements WHERE id=?').get(req.params.id));
});

// DELETE /api/platform/announcements/:id
router.delete('/:id', ...guard, (req, res) => {
  platformDb.prepare('DELETE FROM platform_announcements WHERE id=?').run(req.params.id);
  logAction(req, 'announcement.deleted', 'platform_announcement', req.params.id, {});
  res.status(204).end();
});

module.exports = router;
