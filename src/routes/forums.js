const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const authenticate = require('../middleware/auth');
const { v4: uuid } = require('uuid');
const { upload, UPLOADS_ROOT, messageTypeForMime } = require('../utils/forumUploads');

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

// Keeps the thread's cached message_count/updated_at accurate after any
// insert or delete — recounting (rather than +1/-1) so it self-corrects
// even if it ever drifted.
async function syncThreadCount(db, threadId) {
  const count = await db.forumMessage.count({ where: { thread_id: threadId } });
  await db.forumThread.update({ where: { id: threadId }, data: { updated_at: new Date(), message_count: count } });
}

// A user may delete their own message; super_admin (head_teacher is a
// legacy alias, matching middleware/authorize.js) may delete anyone's.
function canDeleteMessage(user, message) {
  const role = user.role === 'head_teacher' ? 'super_admin' : user.role;
  return message.author_id === user.id || role === 'super_admin';
}

// Best-effort cleanup of the on-disk file backing a message, if any.
function deleteMessageFile(message) {
  const url = message.image_url || message.video_url || message.voice_url;
  if (!url || !url.startsWith('/uploads/')) return;
  const filePath = path.join(UPLOADS_ROOT, url.replace('/uploads/', ''));
  fs.unlink(filePath, () => {});
}

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
  await syncThreadCount(req.db, req.params.id);
  res.status(201).json(created);
});

// POST /threads/:id/upload — multipart image/video/voice-note upload.
// One request does both the file save and the message-create, so the
// response shape matches POST /threads/:id/messages exactly.
router.post('/threads/:id/upload', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(422).json({ error: 'file required' });
  const type = messageTypeForMime(req.file.mimetype);
  const url = `/uploads/${req.user.school_id}/forums/${req.file.filename}`;
  const duration = req.body.duration ? parseInt(req.body.duration, 10) : null;

  const msgId = uuid();
  const created = await req.db.forumMessage.create({
    data: {
      id: msgId, thread_id: req.params.id, author: req.user.name, author_id: req.user.id, type,
      image_url: type === 'image' ? url : null,
      video_url: type === 'video' ? url : null,
      video_duration: type === 'video' ? duration : null,
      voice_url: type === 'voice' ? url : null,
      voice_duration: type === 'voice' ? duration : null,
    },
  });
  await syncThreadCount(req.db, req.params.id);
  res.status(201).json(created);
});

router.delete('/threads/:threadId/messages/:msgId', authenticate, async (req, res) => {
  const message = await req.db.forumMessage.findUnique({ where: { id: req.params.msgId } });
  if (!message || message.thread_id !== req.params.threadId) return res.status(404).json({ error: 'Message not found' });
  if (!canDeleteMessage(req.user, message)) return res.status(403).json({ error: 'Not your message' });

  await req.db.forumMessage.deleteMany({ where: { id: req.params.msgId, thread_id: req.params.threadId } });
  deleteMessageFile(message);
  await syncThreadCount(req.db, req.params.threadId);
  res.status(204).end();
});

module.exports = router;
