const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const multer = require('multer');
const { DatabaseSync } = require('node:sqlite');
const platformDb = require('../../db/platform');
const tenantContext = require('../../db/tenantContext');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');
const { logAction } = require('./_helpers');

const guard = [authenticatePlatform, authorizePlatform('platform_owner')];
const upload = multer({ dest: path.join(require('os').tmpdir(), 'sms-restore-uploads') });

// GET /api/platform/backup/export — zips every tenant .db file (WAL-checkpointed first)
router.get('/export', ...guard, (req, res) => {
  const schools = platformDb.prepare('SELECT id, name FROM schools').all();

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="backup-${Date.now()}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => { throw err; });
  archive.pipe(res);

  for (const school of schools) {
    try {
      const conn = tenantContext.getOrOpen(school.id);
      conn.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (_) { /* if it can't be opened/checkpointed, still try to include the file as-is */ }

    const filePath = tenantContext.pathFor(school.id);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name: `${school.name.replace(/[^a-z0-9]/gi, '_')}-${school.id}.db` });
    }
  }

  const platformDbPath = path.resolve(process.env.PLATFORM_DB_PATH || './data/platform.db');
  try { platformDb.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) {}
  if (fs.existsSync(platformDbPath)) archive.file(platformDbPath, { name: 'platform.db' });

  logAction(req, 'backup.exported', 'platform', null, { schoolCount: schools.length });
  archive.finalize();
});

// POST /api/platform/backup/restore/:schoolId — replace one tenant's .db file from an uploaded file
router.post('/restore/:schoolId', ...guard, upload.single('file'), (req, res) => {
  const school = platformDb.prepare('SELECT id FROM schools WHERE id=?').get(req.params.schoolId);
  if (!school) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'School not found' });
  }
  if (!req.file) return res.status(422).json({ error: 'file is required' });

  try {
    const test = new DatabaseSync(req.file.path);
    const hasSchoolTable = test.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='school'").get();
    test.close();
    if (!hasSchoolTable) throw new Error('Uploaded file is not a valid tenant database');
  } catch (e) {
    fs.unlinkSync(req.file.path);
    return res.status(422).json({ error: 'Invalid backup file', detail: e.message });
  }

  tenantContext.evict(req.params.schoolId);
  const targetPath = tenantContext.pathFor(req.params.schoolId);
  fs.copyFileSync(req.file.path, targetPath);
  fs.unlinkSync(req.file.path);
  // Drop stale WAL/SHM sidecars so the restored file isn't shadowed by old ones
  for (const ext of ['-wal', '-shm']) {
    const sidecar = targetPath + ext;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }

  logAction(req, 'backup.restored', 'school', req.params.schoolId, {});
  res.json({ message: 'School database restored' });
});

module.exports = router;
