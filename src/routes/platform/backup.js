// Redesigned for Postgres: the original zipped raw SQLite .db files, which has
// no Postgres analog. pg_dump/pg_restore (the natural replacement) aren't
// guaranteed to be installed wherever this backend runs (confirmed absent on
// this dev machine), so this uses a Prisma-based logical JSON export/import
// per tenant schema instead — no external binary dependency, works anywhere
// Node runs. Same user-facing contract: download one zip for all schools,
// upload one school's export file to restore it.
const router = require('express').Router();
const archiver = require('archiver');
const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const platformClient = require('../../db/platformClient');
const tenantPool = require('../../db/tenantPool');
const { provisionTenantSchema } = require('../../db/provisionTenant');
const authenticatePlatform = require('../../middleware/authenticatePlatform');
const authorizePlatform = require('../../middleware/authorizePlatform');
const { logAction } = require('./_helpers');

const guard = [authenticatePlatform, authorizePlatform('platform_owner')];
const upload = multer({ dest: path.join(os.tmpdir(), 'sms-restore-uploads') });

// Table order matters for restore (FK dependencies) — same shape as
// scripts/migrate-to-postgres.js's tenant ordering.
const TABLE_ORDER = [
  'school', 'academicYear', 'term', 'gradeLevel', 'subject',
  'teacher', 'class', 'student', 'parent', 'parentStudent', 'user',
  'attendanceRecord', 'teacherAttendance', 'teacherSchedule', 'mark',
  'reportCard', 'reportCardEntry', 'feeRecord', 'payment', 'teacherPayroll',
  'announcement', 'emailAlert', 'forumThread', 'forumMessage',
  'studentBehavior', 'salaryWithdrawal',
];

async function exportSchoolData(schoolId) {
  const tenantDb = tenantPool.getOrOpen(schoolId);
  const tables = {};
  for (const model of TABLE_ORDER) {
    tables[model] = await tenantDb[model].findMany();
  }
  return { exportedAt: new Date().toISOString(), schoolId, tables };
}

// GET /api/platform/backup/export — one JSON file per school + platform registry, zipped
router.get('/export', ...guard, async (req, res) => {
  const schools = await platformClient.school.findMany();

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="backup-${Date.now()}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => { throw err; });
  archive.pipe(res);

  for (const school of schools) {
    try {
      const data = await exportSchoolData(school.id);
      archive.append(JSON.stringify(data), { name: `${school.name.replace(/[^a-z0-9]/gi, '_')}-${school.id}.json` });
    } catch (e) {
      console.error(`[backup] failed to export ${school.id}:`, e.message);
    }
  }

  const platformData = {
    exportedAt: new Date().toISOString(),
    subscription_plans: await platformClient.subscriptionPlan.findMany(),
    schools,
    platform_settings: await platformClient.platformSetting.findMany(),
    features: await platformClient.feature.findMany(),
  };
  archive.append(JSON.stringify(platformData), { name: 'platform.json' });

  await logAction(req, 'backup.exported', 'platform', null, { schoolCount: schools.length });
  archive.finalize();
});

// POST /api/platform/backup/restore/:schoolId — replace one school's data from an uploaded export file
router.post('/restore/:schoolId', ...guard, upload.single('file'), async (req, res) => {
  const school = await platformClient.school.findUnique({ where: { id: req.params.schoolId } });
  if (!school) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'School not found' });
  }
  if (!req.file) return res.status(422).json({ error: 'file is required' });

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(req.file.path, 'utf8'));
    if (!payload.tables || typeof payload.tables !== 'object') throw new Error('missing "tables" object');
  } catch (e) {
    fs.unlinkSync(req.file.path);
    return res.status(422).json({ error: 'Invalid backup file', detail: e.message });
  }
  fs.unlinkSync(req.file.path);

  // Ensure the tenant schema exists (idempotent) before writing into it.
  await provisionTenantSchema(req.params.schoolId);
  const tenantDb = tenantPool.getOrOpen(req.params.schoolId);

  // teacher/student/parent <-> user is a circular FK (same shape handled in
  // scripts/migrate-to-postgres.js): insert those three with user_id stripped,
  // load user afterward, then backfill user_id in a second pass.
  const CIRCULAR = ['teacher', 'student', 'parent'];

  try {
    await tenantDb.$transaction(async (tx) => {
      // Wipe in reverse dependency order, then reload forward — mirrors the
      // FK-respecting order used by the original data migration script.
      for (const model of [...TABLE_ORDER].reverse()) {
        await tx[model].deleteMany();
      }
      for (const model of TABLE_ORDER) {
        const rows = payload.tables[model] || [];
        if (rows.length === 0) continue;
        if (CIRCULAR.includes(model)) {
          await tx[model].createMany({ data: rows.map(({ user_id, ...rest }) => rest) });
        } else {
          await tx[model].createMany({ data: rows });
        }
      }
      for (const model of CIRCULAR) {
        for (const row of payload.tables[model] || []) {
          if (row.user_id) await tx[model].update({ where: { id: row.id }, data: { user_id: row.user_id } });
        }
      }
    }, { timeout: 60000 });
  } catch (e) {
    return res.status(500).json({ error: 'Restore failed', detail: e.message });
  }

  await logAction(req, 'backup.restored', 'school', req.params.schoolId, {});
  res.json({ message: 'School database restored' });
});

module.exports = router;
