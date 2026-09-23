/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Multer config for teacher document attachments — same per-tenant
// disk-storage pattern as backend/src/utils/studentUploads.js.
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuid } = require('uuid');

const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const schoolId = req.user?.school_id;
    if (!schoolId) return cb(new Error('Missing tenant context for upload'));
    const dir = path.join(UPLOADS_ROOT, schoolId, 'teachers');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    cb(null, `${uuid()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok = file.mimetype.startsWith('image/') || DOCUMENT_MIME_TYPES.has(file.mimetype);
    if (ok) return cb(null, true);
    cb(new Error(`Unsupported file type for ${file.fieldname}: ${file.mimetype}`));
  },
});

module.exports = { upload };
