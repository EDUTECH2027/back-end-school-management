const router = require('express').Router();
const db = require('../db/database');
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

router.get('/', authenticate, (_req, res) => {
  res.json(db.prepare('SELECT * FROM subjects ORDER BY name').all());
});

router.post('/', authenticate, (req, res) => {
  const { name, code } = req.body;
  if (!name || !code) return res.status(422).json({ error: 'name and code required' });
  const id = uuid();
  db.prepare('INSERT INTO subjects VALUES (?,?,?)').run(id, name, code);
  res.status(201).json(db.prepare('SELECT * FROM subjects WHERE id=?').get(id));
});

router.put('/:id', authenticate, (req, res) => {
  const { name, code } = req.body;
  db.prepare('UPDATE subjects SET name=?,code=? WHERE id=?').run(name, code, req.params.id);
  res.json(db.prepare('SELECT * FROM subjects WHERE id=?').get(req.params.id));
});

router.delete('/:id', authenticate, (req, res) => {
  db.prepare('DELETE FROM subjects WHERE id=?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
