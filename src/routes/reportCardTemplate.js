/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
const router = require('express').Router();
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const fs = require('fs');
const { Prisma } = require('../../node_modules/.prisma/tenant-client');
const { upload } = require('../utils/reportCardTemplateUpload');

// Everything but the PDF bytes, which are large and only served through the file URL.
const PUBLIC = { id: true, is_enabled: true, file_path: true, file_name: true, page_width: true, page_height: true, fields: true, updated_at: true, html_meta: true, render_mode: true };

// GET /api/report-card-template — any authenticated user (admin designer + report cards page both read this)
router.get('/', authenticate, async (req, res) => {
  const row = await req.db.reportCardTemplate.findUnique({ where: { id: 's1' }, select: PUBLIC });
  res.json(row ?? {
    id: 's1', is_enabled: false, file_path: null, file_name: null,
    page_width: null, page_height: null, fields: [], html_meta: null, render_mode: 'overlay',
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
    update: { file_path, file_name: req.file.originalname, file_data, page_width: null, page_height: null, fields: [], is_enabled: false, html_template: Prisma.DbNull, html_meta: Prisma.DbNull, render_mode: 'overlay', updated_at: new Date() },
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

// ── PDF → HTML/CSS template (Phase 1 of the universal template engine) ───────────────────────────
// The browser converts the uploaded PDF (pdf.js already runs there) and sends the result here; the server
// validates and stores it per school, next to the original PDF. Report cards are filled from it on demand.
const MAX_HTML_BYTES = 30 * 1024 * 1024;
const UNSAFE_HTML = /<\s*(script|iframe|object|embed|link|meta\s+http-equiv)\b|\son[a-z]+\s*=|javascript:/i;

function validateHtmlTemplate(body) {
  const { html, css, assets, metadata } = body || {};
  if (typeof html !== 'string' || !html.includes('<!--rc:body-->') || !html.includes('<!--/rc:body-->')) return 'html must be a converted template document';
  if (typeof css !== 'string') return 'css is required';
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) return 'assets must be an object';
  if (!metadata || typeof metadata !== 'object' || !metadata.pageSettings || !Array.isArray(metadata.pages)) return 'metadata is incomplete';
  if (UNSAFE_HTML.test(html) || UNSAFE_HTML.test(css)) return 'the template contains disallowed markup (scripts, frames or event handlers)';
  for (const [id, a] of Object.entries(assets)) {
    if (!/^\w+$/.test(id) || !a || typeof a.dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(a.dataUrl)) return `asset ${id} is not a valid image`;
  }
  return null;
}

// PUT /api/report-card-template/html — admin only. Stores the converted template. It never switches the render mode:
// the administrator approves the HTML template explicitly (PUT /render-mode).
router.put('/html', authenticate, authorize('super_admin'), async (req, res) => {
  const err = validateHtmlTemplate(req.body);
  if (err) return res.status(422).json({ error: err });
  const { html, css, assets, metadata } = req.body;
  const row = await req.db.reportCardTemplate.findUnique({ where: { id: 's1' }, select: { id: true } });
  if (!row) return res.status(409).json({ error: 'Upload a PDF template first' });
  const updated = await req.db.reportCardTemplate.update({
    where: { id: 's1' },
    data: { html_template: { html, css, assets }, html_meta: metadata, render_mode: 'overlay', updated_at: new Date() },
    select: PUBLIC,
  });
  res.json(updated);
});

// GET /api/report-card-template/html — any authenticated user (the Report Cards page renders from it).
router.get('/html', authenticate, async (req, res) => {
  const row = await req.db.reportCardTemplate.findUnique({ where: { id: 's1' }, select: { html_template: true, html_meta: true } });
  const t = row?.html_template;
  if (!t || typeof t.html !== 'string') return res.status(404).json({ error: 'No HTML template has been generated yet' });
  const html = t.html.replace(/\{\{asset:(\w+)\}\}/g, (_m, id) => t.assets?.[id]?.dataUrl ?? '');
  res.json({ html, css: t.css, metadata: row.html_meta });
});

// PUT /api/report-card-template/render-mode — admin only: approve (html) or revert (overlay) the converted template.
router.put('/render-mode', authenticate, authorize('super_admin'), async (req, res) => {
  const mode = req.body?.mode;
  if (mode !== 'overlay' && mode !== 'html') return res.status(422).json({ error: "mode must be 'overlay' or 'html'" });
  const row = await req.db.reportCardTemplate.findUnique({ where: { id: 's1' }, select: { html_meta: true } });
  if (mode === 'html' && !row?.html_meta) return res.status(409).json({ error: 'Convert the PDF to an HTML template first' });
  const updated = await req.db.reportCardTemplate.update({ where: { id: 's1' }, data: { render_mode: mode, updated_at: new Date() }, select: PUBLIC });
  res.json(updated);
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
