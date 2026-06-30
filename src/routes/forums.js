const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

// ── Threads ─────────────────────────────────────────────────────────

router.get('/threads', authenticate, (req, res) => {
  const { tag } = req.query;
  let sql = `SELECT ft.*,
    (SELECT COUNT(*) FROM forum_messages fm WHERE fm.thread_id=ft.id) as message_count
    FROM forum_threads ft WHERE 1=1`;
  const params = [];
  if (tag) { sql += ' AND ft.tag=?'; params.push(tag); }
  sql += ' ORDER BY ft.is_pinned DESC, ft.updated_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/threads/:id', authenticate, (req, res) => {
  const thread = db.prepare('SELECT * FROM forum_threads WHERE id=?').get(req.params.id);
  if (!thread) return res.status(404).json({ error: 'Thread not found' });
  res.json(thread);
});

router.post('/threads', authenticate, (req, res) => {
  const { title, tag } = req.body;
  if (!title) return res.status(422).json({ error: 'title required' });
  const id = uuid();
  db.prepare(`INSERT INTO forum_threads VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
    .run(id, title, tag||'general', req.user.name, req.user.id, 0, 0);
  res.status(201).json(db.prepare('SELECT * FROM forum_threads WHERE id=?').get(id));
});

router.delete('/threads/:id', authenticate, (req, res) => {
  db.prepare('DELETE FROM forum_threads WHERE id=?').run(req.params.id);
  res.status(204).end();
});

// ── Messages ─────────────────────────────────────────────────────────

router.get('/threads/:id/messages', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM forum_messages WHERE thread_id=? ORDER BY created_at').all(req.params.id);
  res.json(rows);
});

router.post('/threads/:id/messages', authenticate, (req, res) => {
  const { type = 'text', content, imageUrl, voiceUrl, voiceDuration } = req.body;
  if (type === 'text' && !content) return res.status(422).json({ error: 'content required for text messages' });
  const msgId = uuid();
  db.prepare(`INSERT INTO forum_messages VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`)
    .run(msgId, req.params.id, req.user.name, req.user.id, type, content||null, imageUrl||null, voiceUrl||null, voiceDuration||null);
  // bump thread updated_at and message_count
  db.prepare(`UPDATE forum_threads SET updated_at=datetime('now'), message_count=(SELECT COUNT(*) FROM forum_messages WHERE thread_id=?) WHERE id=?`)
    .run(req.params.id, req.params.id);
  res.status(201).json(db.prepare('SELECT * FROM forum_messages WHERE id=?').get(msgId));
});

router.delete('/threads/:threadId/messages/:msgId', authenticate, (req, res) => {
  db.prepare('DELETE FROM forum_messages WHERE id=? AND thread_id=?').run(req.params.msgId, req.params.threadId);
  res.status(204).end();
});

module.exports = router;
