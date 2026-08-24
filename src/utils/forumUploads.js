// Single source of truth for how forum media (images/videos/voice notes) is
// stored on disk. Local-disk storage is a deliberate first step — see the
// project plan notes on why (no cloud bucket wired up yet); files live under
// a per-school folder so one tenant's uploads never mix with another's on
// the shared disk.
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuid } = require('uuid');

const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');

const ALLOWED_PREFIXES = ['image/', 'video/', 'audio/'];

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const schoolId = req.user?.school_id;
    if (!schoolId) return cb(new Error('Missing tenant context for upload'));
    const dir = path.join(UPLOADS_ROOT, schoolId, 'forums');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    cb(null, `${uuid()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_PREFIXES.some(p => file.mimetype.startsWith(p))) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

// image/* -> image, video/* -> video, audio/* -> voice (matches ForumMessageType)
function messageTypeForMime(mimetype) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  return 'voice';
}

module.exports = { upload, UPLOADS_ROOT, messageTypeForMime };
