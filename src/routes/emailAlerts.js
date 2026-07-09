const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

router.get('/', authenticate, async (req, res) => {
  const { status, recipient } = req.query;
  const where = {};
  if (status) where.status = status;
  if (recipient) where.recipient = { contains: recipient, mode: 'insensitive' };
  res.json(await req.db.emailAlert.findMany({ where, orderBy: { sent_at: 'desc' } }));
});

router.post('/', authenticate, async (req, res) => {
  const { subject, body, recipient, status } = req.body;
  if (!subject || !body || !recipient) return res.status(422).json({ error: 'subject, body and recipient required' });
  const id = uuid();
  const created = await req.db.emailAlert.create({
    data: { id, subject, body, recipient, sender: req.user.name, sender_id: req.user.id, status: status || 'sent' },
  });
  res.status(201).json(created);
});

router.delete('/:id', authenticate, async (req, res) => {
  await req.db.emailAlert.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
