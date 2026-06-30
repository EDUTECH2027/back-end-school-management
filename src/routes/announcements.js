const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

router.get('/', authenticate, (req, res) => {
  const { audience, isPinned } = req.query;
  let sql = 'SELECT * FROM announcements WHERE 1=1';
  const params = [];
  if (audience) { sql += ' AND (audience=? OR audience="all")'; params.push(audience); }
  if (isPinned !== undefined) { sql += ' AND is_pinned=?'; params.push(isPinned === 'true' ? 1 : 0); }
  sql += ' ORDER BY is_pinned DESC, created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Announcement not found' });
  res.json(row);
});

router.post('/', authenticate, (req, res) => {
  const { title, body, audience, isPinned, type } = req.body;
  if (!title || !body) return res.status(422).json({ error: 'title and body required' });
  const id = uuid();
  db.prepare(`INSERT INTO announcements (id,title,body,author,author_id,audience,is_pinned,type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
    .run(id, title, body, req.user.name, req.user.id, audience||'all', isPinned ? 1 : 0, type||'info');
  res.status(201).json(db.prepare('SELECT * FROM announcements WHERE id=?').get(id));
});

router.put('/:id', authenticate, (req, res) => {
  const { title, body, audience, isPinned, type } = req.body;
  db.prepare(`UPDATE announcements SET title=?,body=?,audience=?,is_pinned=?,type=?,updated_at=datetime('now') WHERE id=?`)
    .run(title, body, audience||'all', isPinned ? 1 : 0, type||'info', req.params.id);
  res.json(db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id));
});

router.delete('/:id', authenticate, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id=?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
