const router = require('express').Router();
const { v4: uuid } = require('uuid');
const platformClient = require('../../db/platformClient');
const tenantPool = require('../../db/tenantPool');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');
const { logAction } = require('./_helpers');

const guard = [authenticatePlatform, authorizePlatform()];

// GET /api/platform/announcements
router.get('/', ...guard, async (req, res) => {
  res.json(await platformClient.platformAnnouncement.findMany({ orderBy: [{ is_pinned: 'desc' }, { created_at: 'desc' }] }));
});

// POST /api/platform/announcements
router.post('/', ...guard, async (req, res) => {
  const { title, body, is_pinned } = req.body;
  if (!title || !body) return res.status(422).json({ error: 'title and body are required' });

  const id = uuid();
  const created = await platformClient.platformAnnouncement.create({ data: { id, title, body, is_pinned: !!is_pinned } });

  const schools = await platformClient.school.findMany({ select: { id: true } });
  const announcementData = {
    id,
    title,
    body,
    author: req.user?.name || 'Platform Admin',
    author_id: null,
    audience: 'all',
    is_pinned: !!is_pinned,
    type: 'info',
  };

  await Promise.allSettled(schools.map(({ id: schoolId }) => {
    const tenantDb = tenantPool.getOrOpen(schoolId);
    return tenantDb.announcement.create({ data: announcementData });
  }));

  await logAction(req, 'announcement.created', 'platform_announcement', id, { title });
  res.status(201).json(created);
});

// PUT /api/platform/announcements/:id
router.put('/:id', ...guard, async (req, res) => {
  const current = await platformClient.platformAnnouncement.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: 'Announcement not found' });

  const { title, body, is_pinned } = req.body;
  const updated = await platformClient.platformAnnouncement.update({
    where: { id: req.params.id },
    data: {
      title: title ?? current.title,
      body: body ?? current.body,
      is_pinned: is_pinned !== undefined ? !!is_pinned : current.is_pinned,
      updated_at: new Date(),
    },
  });

  const schools = await platformClient.school.findMany({ select: { id: true } });
  const tenantData = {
    title: title ?? current.title,
    body: body ?? current.body,
    is_pinned: is_pinned !== undefined ? !!is_pinned : current.is_pinned,
    updated_at: new Date(),
  };

  await Promise.allSettled(schools.map(({ id: schoolId }) => {
    const tenantDb = tenantPool.getOrOpen(schoolId);
    return tenantDb.announcement.updateMany({ where: { id: req.params.id }, data: tenantData });
  }));

  res.json(updated);
});

// DELETE /api/platform/announcements/:id
router.delete('/:id', ...guard, async (req, res) => {
  await platformClient.platformAnnouncement.deleteMany({ where: { id: req.params.id } });

  const schools = await platformClient.school.findMany({ select: { id: true } });
  await Promise.allSettled(schools.map(({ id: schoolId }) => {
    const tenantDb = tenantPool.getOrOpen(schoolId);
    return tenantDb.announcement.deleteMany({ where: { id: req.params.id } });
  }));

  await logAction(req, 'announcement.deleted', 'platform_announcement', req.params.id, {});
  res.status(204).end();
});

module.exports = router;
