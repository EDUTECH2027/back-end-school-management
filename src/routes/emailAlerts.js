const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

router.get('/', authenticate, (req, res) => {
  const { status, recipient } = req.query;
  let sql = 'SELECT * FROM email_alerts WHERE 1=1';
  const params = [];
  if (status)    { sql += ' AND status=?';    params.push(status); }
  if (recipient) { sql += ' AND recipient LIKE ?'; params.push(`%${recipient}%`); }
  sql += ' ORDER BY sent_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', authenticate, (req, res) => {
  const { subject, body, recipient, status } = req.body;
  if (!subject || !body || !recipient) return res.status(422).json({ error: 'subject, body and recipient required' });
  const id = uuid();
  db.prepare(`INSERT INTO email_alerts VALUES (?,?,?,?,?,?,?,datetime('now'))`)
    .run(id, subject, body, recipient, req.user.name, req.user.id, status||'sent');
  res.status(201).json(db.prepare('SELECT * FROM email_alerts WHERE id=?').get(id));
});

router.delete('/:id', authenticate, (req, res) => {
  db.prepare('DELETE FROM email_alerts WHERE id=?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
