const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

router.get('/', authenticate, async (req, res) => {
  res.json(await req.db.subject.findMany({ orderBy: { name: 'asc' } }));
});

router.post('/', authenticate, async (req, res) => {
  const { name, code } = req.body;
  if (!name || !code) return res.status(422).json({ error: 'name and code required' });
  const id = uuid();
  const created = await req.db.subject.create({ data: { id, name, code } });
  res.status(201).json(created);
});

router.put('/:id', authenticate, async (req, res) => {
  const { name, code } = req.body;
  const updated = await req.db.subject.update({ where: { id: req.params.id }, data: { name, code } });
  res.json(updated);
});

router.delete('/:id', authenticate, async (req, res) => {
  await req.db.subject.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
