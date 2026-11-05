/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const fs = require('fs');
const { upload } = require('../utils/reportCardTemplateUpload');

// Everything but the PDF bytes, which are large and only served through the file URL.
const PUBLIC = { id: true, is_enabled: true, file_path: true, file_name: true, page_width: true, page_height: true, fields: true, updated_at: true };

// GET /api/report-card-template — any authenticated user (admin designer + report cards page both read this)
router.get('/', authenticate, async (req, res) => {
  const row = await req.db.reportCardTemplate.findUnique({ where: { id: 's1' }, select: PUBLIC });
  res.json(row ?? {
    id: 's1', is_enabled: false, file_path: null, file_name: null,
    page_width: null, page_height: null, fields: [],
  });
});

// POST /api/report-card-template/upload — admin only. Replaces the PDF file;
// resets fields/page size and disables the template until the admin re-maps
// fields in the designer, so a half-mapped template never goes live silently.
router.post('/upload', authenticate, authorize('super_admin'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(422).json({ error: 'file required' });
  const file_path = `/uploads/${req.user.school_id}/report-card-template/${req.file.filename}`;
  // Keep the bytes in the database so the template survives redeploys (disk is wiped on Render).
  const file_data = fs.readFileSync(req.file.path);
  const row = await req.db.reportCardTemplate.upsert({
    where: { id: 's1' },
    update: { file_path, file_name: req.file.originalname, file_data, page_width: null, page_height: null, fields: [], is_enabled: false, updated_at: new Date() },
    create: { id: 's1', file_path, file_name: req.file.originalname, file_data, is_enabled: false, fields: [] },
    select: PUBLIC,
  });
  res.status(201).json(row);
});

// PUT /api/report-card-template — admin only. Saves field positions / page size / enabled flag.
router.put('/', authenticate, authorize('super_admin'), async (req, res) => {
  const { is_enabled, page_width, page_height, fields } = req.body;
  const row = await req.db.reportCardTemplate.upsert({
    where: { id: 's1' },
    update: {
      is_enabled: is_enabled ?? false,
      page_width: page_width ?? null,
      page_height: page_height ?? null,
      fields: fields ?? [],
      updated_at: new Date(),
    },
    create: {
      id: 's1', is_enabled: is_enabled ?? false, page_width: page_width ?? null,
      page_height: page_height ?? null, fields: fields ?? [],
    },
    select: PUBLIC,
  });
  res.json(row);
});

// GET /uploads/:schoolId/report-card-template/:file (mounted in index.js after the static handler):
// serves the PDF from the database when the copy on disk no longer exists.
router.serveStoredFile = async (req, res, next) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.schoolId)) return next();
    const row = await require('../db/tenantPool').getOrOpen(req.params.schoolId).reportCardTemplate
      .findUnique({ where: { id: 's1' }, select: { file_path: true, file_data: true } });
    if (!row?.file_data || !row.file_path?.endsWith('/' + req.params.file)) return next();
    res.type('application/pdf').send(Buffer.from(row.file_data));
  } catch { next(); }
};

module.exports = router;
