const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');

// ── Threads ─────────────────────────────────────────────────────────

router.get('/threads', authenticate, async (req, res) => {
  const { tag } = req.query;
  const where = tag ? { tag } : {};
  const threads = await req.db.forumThread.findMany({
    where, orderBy: [{ is_pinned: 'desc' }, { updated_at: 'desc' }],
    include: { _count: { select: { messages: true } } },
  });
  res.json(threads.map(t => ({ ...t, message_count: t._count.messages, _count: undefined })));
});

router.get('/threads/:id', authenticate, async (req, res) => {
  const thread = await req.db.forumThread.findUnique({ where: { id: req.params.id } });
  if (!thread) return res.status(404).json({ error: 'Thread not found' });
  res.json(thread);
});

router.post('/threads', authenticate, async (req, res) => {
  const { title, tag } = req.body;
  if (!title) return res.status(422).json({ error: 'title required' });
  const id = uuid();
  const created = await req.db.forumThread.create({
    data: { id, title, tag: tag || 'general', author: req.user.name, author_id: req.user.id, is_pinned: false, message_count: 0 },
  });
  res.status(201).json(created);
});

router.delete('/threads/:id', authenticate, async (req, res) => {
  await req.db.forumThread.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

// ── Messages ─────────────────────────────────────────────────────────

router.get('/threads/:id/messages', authenticate, async (req, res) => {
  res.json(await req.db.forumMessage.findMany({ where: { thread_id: req.params.id }, orderBy: { created_at: 'asc' } }));
});

router.post('/threads/:id/messages', authenticate, async (req, res) => {
  const { type = 'text', content, imageUrl, voiceUrl, voiceDuration } = req.body;
  if (type === 'text' && !content) return res.status(422).json({ error: 'content required for text messages' });
  const msgId = uuid();
  const created = await req.db.forumMessage.create({
    data: {
      id: msgId, thread_id: req.params.id, author: req.user.name, author_id: req.user.id,
      type, content: content || null, image_url: imageUrl || null, voice_url: voiceUrl || null, voice_duration: voiceDuration || null,
    },
  });
  // bump thread updated_at and message_count
  const count = await req.db.forumMessage.count({ where: { thread_id: req.params.id } });
  await req.db.forumThread.update({ where: { id: req.params.id }, data: { updated_at: new Date(), message_count: count } });
  res.status(201).json(created);
});

router.delete('/threads/:threadId/messages/:msgId', authenticate, async (req, res) => {
  await req.db.forumMessage.deleteMany({ where: { id: req.params.msgId, thread_id: req.params.threadId } });
  res.status(204).end();
});

module.exports = router;
