// Multer config for the admin-uploaded report card PDF template — same
// per-tenant disk-storage pattern as studentUploads.js/teacherUploads.js.
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuid } = require('uuid');

const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const schoolId = req.user?.school_id;
    if (!schoolId) return cb(new Error('Missing tenant context for upload'));
    const dir = path.join(UPLOADS_ROOT, schoolId, 'report-card-template');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    cb(null, `${uuid()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (file.mimetype === 'application/pdf') return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype}. Only PDF is accepted.`));
  },
});

module.exports = { upload, UPLOADS_ROOT };
